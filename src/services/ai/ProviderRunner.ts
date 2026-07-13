import { spawn, spawnSync } from 'child_process';
import { requestUrl, type RequestUrlResponse } from 'obsidian';
import {
	AI_TOOL,
	type AIModelOption,
	type AITool,
	type PluginSettings,
} from '../../core/types';
import { getKeychainSecret } from '../KeychainSecrets';
import { AI_DISPATCH_PHASE, type AIDispatchPhase } from './AIDispatchPhase';
import type { PromptFileInfo } from './PromptFileInfo';
import type { ProviderRunResult } from './ProviderRunResult';
import {
	MAX_PROVIDER_ERROR_TEXT_LENGTH,
	normalizeOpenRouterBaseUrl,
	sanitizeProviderText,
	validateToolPath,
} from './ProviderSecurity';

/** Cursor SDK model selector accepted by the Agent API. */
type CursorSdkModelSelection = { id: string };

/** Cursor SDK local execution controls used during agent creation and prompt sends. */
type CursorSdkLocalOptions = {
	cwd?: string | string[];
	sandboxOptions?: { enabled: boolean };
	force?: boolean;
};

/** Cursor SDK agent creation arguments consumed by this plugin. */
type CursorSdkAgentCreateOptions = {
	apiKey: string;
	model?: CursorSdkModelSelection;
	local?: CursorSdkLocalOptions;
};

/** Cursor SDK prompt send options consumed by this plugin. */
type CursorSdkSendOptions = {
	model?: CursorSdkModelSelection;
	local?: CursorSdkLocalOptions;
};

/** Cursor SDK result shape returned after a provider run finishes. */
type CursorSdkRunResult = { status: string; result?: string };

/** Cursor SDK run handle used to await terminal provider status. */
type CursorSdkRun = { wait(): Promise<CursorSdkRunResult> };

/** Cursor SDK agent surface used for prompt dispatch and cleanup. */
type CursorSdkAgent = {
	send(prompt: string, options?: CursorSdkSendOptions): Promise<CursorSdkRun>;
	close?(): void;
};

/** Cursor SDK agent factory surface used by the adapter. */
type CursorSdkAgentFactory = {
	create(options: CursorSdkAgentCreateOptions): Promise<CursorSdkAgent>;
};

/** Cursor SDK model catalog record. */
type CursorSdkModelRecord = { id: string; displayName?: string; aliases?: string[] };

/** Minimal runtime shape consumed from the optional Cursor SDK package. */
type CursorSdkModule = {
	Agent: CursorSdkAgentFactory;
	Cursor: { models: { list(options: { apiKey: string }): Promise<CursorSdkModelRecord[]> } };
};

/** Killable child-process surface retained for unload and user cancellation. */
type KillableProcess = { kill(signal?: NodeJS.Signals | number): boolean };

/** Resolves a CLI command through the login shell used by GUI-launched Obsidian. */
const resolveCommand = (tool: string): string => {
	const userShell = process.env.SHELL || '/bin/zsh';
	const result = spawnSync(userShell, ['-lic', `which '${tool}'`], { timeout: 5000, encoding: 'utf-8' });
	return result.status === 0 ? result.stdout.trim() || tool : tool;
};

/** Launches a detached application without tying it to Obsidian's lifecycle. */
const launchDetached = (command: string, args: string[]): void => {
	spawn(command, args, { detached: true, stdio: 'ignore' });
};

/**
 * Terminal.app accepts a shell command string rather than an executable argv.
 * Keep the script static and let AppleScript quote every caller-supplied value.
 */
const TERMINAL_INTERACTIVE_SESSION_SCRIPT = [
	'on run argv',
	'if (count of argv) < 3 then error "Missing task session arguments."',
	'set workingDirectory to item 1 of argv',
	'set executablePath to item 2 of argv',
	'set commandText to "cd " & quoted form of workingDirectory & " && " & quoted form of executablePath',
	'repeat with argumentIndex from 3 to count of argv',
	'set commandText to commandText & " " & quoted form of (item argumentIndex of argv)',
	'end repeat',
	'tell application "Terminal"',
	'activate',
	'do script commandText',
	'end tell',
	'end run',
].join('\n');

/**
 * Encapsulates provider APIs, optional SDK loading, and child-process execution.
 * Dispatch lifecycle and persistence remain owned by AIDispatcher.
 */
export class ProviderRunner {
	/** Local provider processes that can be terminated during plugin unload. */
	private activeProcesses = new Set<KillableProcess>();

	/** Routes one prompt to the provider selected in plugin settings. */
	async run(
		settings: PluginSettings,
		promptInfo: PromptFileInfo,
		phase: AIDispatchPhase,
	): Promise<ProviderRunResult> {
		if (settings.aiTool === AI_TOOL.CURSOR_SDK) {
			return this.runCursorSdk(settings, promptInfo);
		}
		if (settings.aiTool === AI_TOOL.CODEX_CLI) {
			return this.runCliProvider(settings, promptInfo, AI_TOOL.CODEX_CLI, phase);
		}
		if (settings.aiTool === AI_TOOL.CLAUDE_CODE) {
			return this.runCliProvider(settings, promptInfo, AI_TOOL.CLAUDE_CODE, phase);
		}
		if (settings.aiTool === AI_TOOL.OPENROUTER) {
			if (phase === AI_DISPATCH_PHASE.EXECUTE) {
				throw new Error('OpenRouter cannot execute local file or shell changes.');
			}
			return this.runOpenRouter(settings, promptInfo);
		}
		throw new Error('No AI provider configured.');
	}

	/** Refreshes model options for providers that expose a remote or SDK catalog. */
	async refreshModels(settings: PluginSettings): Promise<AIModelOption[]> {
		try {
			if (settings.aiTool === AI_TOOL.CURSOR_SDK) {
				return await this.listCursorModels(settings);
			}
			if (settings.aiTool === AI_TOOL.OPENROUTER) {
				return await this.listOpenRouterModels(settings);
			}
			return [];
		} catch (error) {
			const providerError = new Error(this.errorMessage(error));
			(providerError as Error & { cause?: unknown }).cause = error;
			throw providerError;
		}
	}

	/** Reports whether a provider is selectable in the current runtime. */
	isAvailable(tool: AITool): boolean {
		if (tool !== AI_TOOL.CURSOR_SDK) {
			return tool !== AI_TOOL.NONE;
		}
		try {
			return this.optionalCursorSdk() !== undefined;
		} catch {
			return false;
		}
	}

	/** Opens a terminal application at the supplied vault path. */
	openTerminal(vaultPath: string, terminalApp: 'ghostty' | 'terminal'): void {
		if (terminalApp === 'ghostty') {
			launchDetached(resolveCommand('ghostty'), ['--working-directory=' + vaultPath]);
		} else {
			launchDetached('open', ['-a', 'Terminal', vaultPath]);
		}
	}

	/**
	 * Requests a new interactive CLI session and returns after the detached launch.
	 * Unsupported providers and malformed launch inputs fail synchronously.
	 */
	openInteractiveTaskSession(settings: PluginSettings, workingDirectory: string, prompt: string): void {
		if (workingDirectory.trim().length === 0) {
			throw new Error('Interactive task sessions require a working directory.');
		}
		if (prompt.trim().length === 0) {
			throw new Error('Interactive task sessions require a prompt.');
		}

		const invocation = this.interactiveCliInvocation(settings, workingDirectory, prompt);
		if (settings.terminalApp === 'ghostty') {
			launchDetached('open', [
				'-na',
				'Ghostty.app',
				'--args',
				`--working-directory=${workingDirectory}`,
				'-e',
				invocation.command,
				...invocation.args,
			]);
			return;
		}

		launchDetached('osascript', [
			'-e',
			TERMINAL_INTERACTIVE_SESSION_SCRIPT,
			'--',
			workingDirectory,
			invocation.command,
			...invocation.args,
		]);
	}

	/** Opens a working directory in the selected editor. */
	openIDE(workingDirectory: string, ide: 'cursor' | 'vscode'): void {
		const tool = ide === 'cursor' ? 'cursor' : 'code';
		launchDetached(resolveCommand(tool), [workingDirectory]);
	}

	/** Sends SIGTERM to every tracked local provider process. */
	killAll(): void {
		for (const processHandle of this.activeProcesses) {
			processHandle.kill('SIGTERM');
		}
		this.activeProcesses.clear();
	}

	/** Converts unknown provider failures into sanitized user-facing text. */
	errorMessage(error: unknown): string {
		const record = this.asRecord(error);
		if (record.status === 401 || record.name === 'AuthenticationError') {
			return 'AI provider rejected the API key. Re-enter a valid key in Settings > AI Integration.';
		}
		const message = error instanceof Error ? error.message : String(error);
		if (message.trim().length > 0 && message !== 'Error') return sanitizeProviderText(message);
		const operation = typeof record.operation === 'string' ? record.operation : '';
		return operation.length > 0 ? `${operation} failed.` : 'AI provider request failed.';
	}

	/** Builds local CLI arguments with bypass flags only when the user enabled them. */
	buildCliArgs(
		settings: PluginSettings,
		tool: typeof AI_TOOL.CODEX_CLI | typeof AI_TOOL.CLAUDE_CODE,
		phase: AIDispatchPhase,
		promptContent: string,
	): string[] {
		if (tool === AI_TOOL.CODEX_CLI) {
			const args = ['--ask-for-approval', 'never', 'exec', '-C', '.'];
			const model = settings.aiProviders.codexCli.model.trim();
			if (model.length > 0) args.push('--model', model);
			if (settings.aiSkipPermissions) {
				args.push('--dangerously-bypass-approvals-and-sandbox');
			} else {
				args.push('--sandbox', phase === AI_DISPATCH_PHASE.PLAN ? 'read-only' : 'workspace-write');
			}
			args.push(promptContent);
			return args;
		}

		const args = ['--print'];
		const model = settings.aiProviders.claudeCode.model.trim();
		if (model.length > 0) args.push('--model', model);
		if (settings.aiSkipPermissions) args.push('--dangerously-skip-permissions');
		args.push(promptContent);
		return args;
	}

	/** Builds the selected provider's interactive executable and argv without a shell. */
	private interactiveCliInvocation(
		settings: PluginSettings,
		workingDirectory: string,
		prompt: string,
	): { command: string; args: string[] } {
		if (settings.aiTool !== AI_TOOL.CODEX_CLI && settings.aiTool !== AI_TOOL.CLAUDE_CODE) {
			throw new Error(
				`Interactive task sessions support only Codex CLI or Claude Code; selected provider "${settings.aiTool}" is unsupported.`,
			);
		}

		const provider = settings.aiTool === AI_TOOL.CODEX_CLI
			? settings.aiProviders.codexCli
			: settings.aiProviders.claudeCode;
		const providerName = settings.aiTool === AI_TOOL.CODEX_CLI ? 'Codex CLI' : 'Claude Code';
		const configuredPath = provider.cliPath.trim();
		if (validateToolPath(configuredPath) === false) {
			throw new Error(`${providerName} path contains invalid characters. Check Settings > AI Integration.`);
		}

		const command = configuredPath || resolveCommand(settings.aiTool === AI_TOOL.CODEX_CLI ? 'codex' : 'claude');
		const args = settings.aiTool === AI_TOOL.CODEX_CLI ? ['-C', workingDirectory] : [];
		const model = provider.model.trim();
		if (model.length > 0) args.push('--model', model);
		args.push('--', prompt);
		return { command, args };
	}

	/** Runs the optional Cursor SDK provider with a Keychain-backed API key. */
	private async runCursorSdk(settings: PluginSettings, promptInfo: PromptFileInfo): Promise<ProviderRunResult> {
		const apiKey = await this.requireApiKey(settings.aiProviders.cursorSdk.apiKey, 'Cursor SDK');
		const model = settings.aiProviders.cursorSdk.model.trim() || 'composer-latest';
		const sdk = this.loadCursorSdk();
		const agent = await sdk.Agent.create({
			apiKey,
			model: { id: model },
			local: {
				cwd: promptInfo.execCwd,
				sandboxOptions: { enabled: settings.aiSkipPermissions === false },
			},
		});
		try {
			const run = await agent.send(promptInfo.promptContent, {
				model: { id: model },
				local: { force: settings.aiSkipPermissions },
			});
			const result = await run.wait();
			if (result.status !== 'finished') {
				throw new Error(`Cursor SDK run ended with status ${result.status}.`);
			}
			return { output: result.result ?? '' };
		} finally {
			agent.close?.();
		}
	}

	/** Runs a local CLI provider with explicit argv and provider-specific environment. */
	private async runCliProvider(
		settings: PluginSettings,
		promptInfo: PromptFileInfo,
		tool: typeof AI_TOOL.CODEX_CLI | typeof AI_TOOL.CLAUDE_CODE,
		phase: AIDispatchPhase,
	): Promise<ProviderRunResult> {
		const toolPath = tool === AI_TOOL.CODEX_CLI
			? settings.aiProviders.codexCli.cliPath || resolveCommand('codex')
			: settings.aiProviders.claudeCode.cliPath || resolveCommand('claude');
		const args = this.buildCliArgs(settings, tool, phase, promptInfo.promptContent);
		const environment = await this.providerEnvironment(settings, tool);
		const output = await this.spawnAndCapture(toolPath, args, promptInfo.execCwd, environment);
		return { output };
	}

	/** Builds a process environment with configured Keychain overrides when present. */
	private async providerEnvironment(
		settings: PluginSettings,
		tool: typeof AI_TOOL.CODEX_CLI | typeof AI_TOOL.CLAUDE_CODE,
	): Promise<NodeJS.ProcessEnv> {
		const environment: NodeJS.ProcessEnv = { ...process.env };
		if (tool === AI_TOOL.CODEX_CLI) {
			const apiKey = await getKeychainSecret(settings.aiProviders.codexCli.apiKey);
			if (apiKey) environment.OPENAI_API_KEY = apiKey;
		} else {
			const apiKey = await getKeychainSecret(settings.aiProviders.claudeCode.apiKey);
			if (apiKey) environment.ANTHROPIC_API_KEY = apiKey;
		}
		return environment;
	}

	/** Spawns a local provider without a shell and captures stdout and stderr. */
	private spawnAndCapture(command: string, args: string[], workingDirectory: string, environment: NodeJS.ProcessEnv): Promise<string> {
		return new Promise((resolve, reject) => {
			const child = spawn(command, args, { cwd: workingDirectory, env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
			this.activeProcesses.add(child);

			const standardOutputChunks: Buffer[] = [];
			const standardErrorChunks: Buffer[] = [];
			child.stdout.on('data', (chunk: Buffer) => standardOutputChunks.push(chunk));
			child.stderr.on('data', (chunk: Buffer) => standardErrorChunks.push(chunk));
			child.on('error', (error: Error) => {
				this.activeProcesses.delete(child);
				reject(error);
			});
			child.on('close', (code: number | null) => {
				this.activeProcesses.delete(child);
				const standardOutput = Buffer.concat(standardOutputChunks).toString('utf-8');
				const standardError = Buffer.concat(standardErrorChunks).toString('utf-8');
				if (code !== 0) {
					reject(new Error(this.providerProcessError(code, standardOutput, standardError)));
					return;
				}
				resolve(standardOutput);
			});
		});
	}

	/** Builds a sanitized local-process failure message from captured output. */
	private providerProcessError(code: number | null, standardOutput: string, standardError: string): string {
		const message = [`Process exited with code ${code ?? 'unknown'}`, standardOutput, standardError]
			.filter((part) => part.trim().length > 0)
			.join('\n');
		return sanitizeProviderText(message);
	}

	/** Runs OpenRouter chat completions for analysis and plan output. */
	private async runOpenRouter(settings: PluginSettings, promptInfo: PromptFileInfo): Promise<ProviderRunResult> {
		const apiKey = await this.requireApiKey(settings.aiProviders.openRouter.apiKey, 'OpenRouter');
		const model = this.resolveOpenRouterModel(settings);
		const baseUrl = this.openRouterBaseUrl(settings);
		const response = await requestUrl({
			url: `${baseUrl}/chat/completions`,
			method: 'POST',
			headers: {
				Authorization: `Bearer ${apiKey}`,
				'Content-Type': 'application/json',
				'HTTP-Referer': 'https://github.com/rankupgames/Vault-Dashboard',
				'X-Title': 'Vaultboard',
			},
			body: JSON.stringify({
				model,
				messages: [{ role: 'user', content: promptInfo.promptContent }],
				stream: false,
			}),
			throw: false,
		});
		if (response.status < 200 || response.status >= 300) {
			throw new Error(this.responseError(response, 'OpenRouter chat request failed'));
		}
		return { output: this.extractOpenRouterText(response.json as unknown) };
	}

	/** Lists Cursor SDK models available to the configured account. */
	private async listCursorModels(settings: PluginSettings): Promise<AIModelOption[]> {
		const apiKey = await this.requireApiKey(settings.aiProviders.cursorSdk.apiKey, 'Cursor SDK');
		const sdk = this.loadCursorSdk();
		const models = await sdk.Cursor.models.list({ apiKey });
		return models.map((model) => ({
			id: model.id,
			name: model.displayName ?? model.id,
		}));
	}

	/** Lists OpenRouter models available to the configured API key. */
	private async listOpenRouterModels(settings: PluginSettings): Promise<AIModelOption[]> {
		const apiKey = await this.requireApiKey(settings.aiProviders.openRouter.apiKey, 'OpenRouter');
		const response = await requestUrl({
			url: `${this.openRouterBaseUrl(settings)}/models/user`,
			headers: {
				Authorization: `Bearer ${apiKey}`,
				Accept: 'application/json',
				'HTTP-Referer': 'https://github.com/rankupgames/Vault-Dashboard',
				'X-Title': 'Vaultboard',
			},
			throw: false,
		});
		if (response.status < 200 || response.status >= 300) {
			throw new Error(this.responseError(response, 'OpenRouter model refresh failed'));
		}
		const record = this.asRecord(response.json as unknown);
		const rawModels = Array.isArray(record.data) ? record.data : [];
		return rawModels
			.map((item): AIModelOption | null => {
				const model = this.asRecord(item);
				const id = typeof model.id === 'string' ? model.id.trim() : '';
				if (id.length === 0) return null;
				return {
					id,
					name: typeof model.name === 'string' && model.name.trim().length > 0 ? model.name.trim() : id,
				};
			})
			.filter((model): model is AIModelOption => model !== null);
	}

	/** Loads a provider API key or reports the settings action required to continue. */
	private async requireApiKey(ref: PluginSettings['aiProviders']['cursorSdk']['apiKey'], label: string): Promise<string> {
		const apiKey = await getKeychainSecret(ref);
		if (apiKey === undefined) {
			throw new Error(`${label} API key not found in macOS Keychain. Save it in Settings > AI Integration.`);
		}
		return apiKey;
	}

	/** Resolves an explicit OpenRouter model or the first cached catalog entry. */
	private resolveOpenRouterModel(settings: PluginSettings): string {
		const configured = settings.aiProviders.openRouter.model.trim();
		if (configured.length > 0) return configured;
		const cached = settings.aiProviders.openRouter.models[0]?.id;
		if (cached) return cached;
		throw new Error('No OpenRouter model selected. Refresh models and choose one in Settings > AI Integration.');
	}

	/** Validates the configured OpenRouter-compatible endpoint. */
	private openRouterBaseUrl(settings: PluginSettings): string {
		return normalizeOpenRouterBaseUrl(settings.aiProviders.openRouter.baseUrl);
	}

	/** Loads the optional Cursor SDK or reports an actionable configuration error. */
	private loadCursorSdk(): CursorSdkModule {
		const module = this.optionalCursorSdk();
		if (module === undefined) {
			throw new Error('Cursor SDK is not installed in this plugin folder. Install @cursor/sdk locally or select a different AI provider.');
		}
		return module;
	}

	/** Attempts to load the optional Cursor SDK without making it a production dependency. */
	private optionalCursorSdk(): CursorSdkModule | undefined {
		try {
			// eslint-disable-next-line @typescript-eslint/no-require-imports -- the SDK is intentionally optional at runtime.
			return this.parseCursorSdkModule(require('@cursor/sdk') as unknown);
		} catch (error) {
			if (this.isMissingCursorSdk(error)) return undefined;
			throw error;
		}
	}

	/** Validates the minimal runtime API expected from the optional Cursor SDK. */
	private parseCursorSdkModule(value: unknown): CursorSdkModule {
		const module = this.asRecord(value);
		const agent = this.asRecord(module.Agent);
		const cursor = this.asRecord(module.Cursor);
		const modelsNamespace = this.asRecord(cursor.models);
		if (typeof agent.create !== 'function' || typeof modelsNamespace.list !== 'function') {
			throw new Error('@cursor/sdk is installed but did not expose the expected Agent/Cursor APIs.');
		}
		return {
			Agent: { create: agent.create as CursorSdkAgentFactory['create'] },
			Cursor: {
				models: {
					list: modelsNamespace.list as CursorSdkModule['Cursor']['models']['list'],
				},
			},
		};
	}

	/** Distinguishes an absent optional package from errors thrown inside that package. */
	private isMissingCursorSdk(error: unknown): boolean {
		const record = this.asRecord(error);
		const message = error instanceof Error ? error.message : String(error);
		return record.code === 'MODULE_NOT_FOUND' && message.includes('@cursor/sdk');
	}

	/** Extracts assistant text from OpenRouter's supported message content shapes. */
	private extractOpenRouterText(value: unknown): string {
		const data = this.asRecord(value);
		const choices = Array.isArray(data.choices) ? data.choices : [];
		const first = this.asRecord(choices[0]);
		const message = this.asRecord(first.message);
		if (typeof message.content === 'string') return message.content;
		if (Array.isArray(message.content)) {
			return message.content
				.map((part) => {
					const record = this.asRecord(part);
					return typeof record.text === 'string' ? record.text : '';
				})
				.join('');
		}
		throw new Error('OpenRouter returned no text content.');
	}

	/** Builds a redacted failure message from a non-successful provider response. */
	private responseError(response: RequestUrlResponse, fallback: string): string {
		const contentLengthHeader = Object.entries(response.headers)
			.find(([name]) => name.toLowerCase() === 'content-length')?.[1];
		const contentLength = Number(contentLengthHeader ?? 0);
		if (contentLength > MAX_PROVIDER_ERROR_TEXT_LENGTH) {
			return `${fallback}: ${response.status} response body omitted (${contentLength} bytes)`;
		}
		const message = response.text.trim().length > 0
			? `${fallback}: ${response.status} ${response.text}`
			: `${fallback}: ${response.status}`;
		return sanitizeProviderText(message);
	}

	/** Treats unknown provider payloads as records without unsafe property access. */
	private asRecord(value: unknown): Record<string, unknown> {
		return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
	}
}
