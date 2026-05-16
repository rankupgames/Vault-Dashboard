/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard
 * Description: AI context assembler and provider dispatcher for local and remote AI tools
 * Created: 2026-03-08
 * Last Modified: 2026-05-16
 */

import { App, TFile, normalizePath, Notice } from 'obsidian';
import {
	AI_TOOL,
	type AIModelOption,
	type AITool,
	type DispatchHistoryEntry,
	type DispatchStatus,
	type PluginSettings,
	type Task,
} from '../core/types';
import { TaskManager } from '../core/TaskManager';
import { ensureVaultFolder } from './VaultUtils';
import { getKeychainSecret } from './KeychainSecrets';

/** Actions the AI dispatcher can perform on task context. */
export type AIAction =
	| 'organize'
	| 'order'
	| 'create-doc'
	| 'delegate';

/** Assembled context passed to the AI prompt composer. */
export interface AIContext {
	tasks: Task[];
	archivedTasks: Task[];
	linkedDocContents: Map<string, string>;
	imagePaths: string[];
}

/** Snapshot of a running or completed dispatch. */
export interface DispatchRecord {
	id: string;
	action: AIAction;
	label: string;
	taskId: string;
	taskTitle: string;
	tool: string;
	status: DispatchStatus;
	startTime: number;
	endTime?: number;
	error?: string;
	output?: string;
	pid?: number;
	vaultPath: string;
	/** Captured plan text from a plan-phase dispatch. */
	planText?: string;
	/** Links an execution dispatch back to its originating plan record. */
	parentPlanId?: string;
}

/** Contract for the stateful AI dispatch lifecycle. */
export interface IAIDispatcher {
	/** Restores dispatch records from persisted history entries. */
	hydrate(entries: DispatchHistoryEntry[]): void;
	/** Serializes active dispatch records for persistence. */
	toJSON(): DispatchHistoryEntry[];
	/** Clears all dispatch records regardless of status. */
	clearAll(): void;
	/** Removes a single dispatch record by ID. */
	removeRecord(id: string): void;

	/** Subscribes to dispatch list changes. Returns an unsubscribe function. */
	onDispatchChange(fn: () => void): () => void;
	/** Subscribes to dispatch finish events. Returns an unsubscribe function. */
	onDispatchFinish(fn: (record: DispatchRecord) => void): () => void;

	/** Returns all dispatch records, newest first. */
	getDispatches(): DispatchRecord[];
	/** Returns a specific dispatch record by ID, or undefined. */
	getRecord(id: string): DispatchRecord | undefined;
	/** Removes completed and failed records from the list. */
	clearFinished(): void;

	/** Dispatches an AI action with the given prompt. Returns the dispatch record ID. */
	dispatch(app: App, settings: PluginSettings, action: AIAction, prompt: string, task?: Task): Promise<string>;
	/** Dispatches a plan-phase request using assembled AI context. Returns the dispatch record ID. */
	dispatchPlan(app: App, settings: PluginSettings, context: AIContext, task: Task): Promise<string>;
	/** Executes an approved plan by its record ID. */
	dispatchExecute(app: App, settings: PluginSettings, planId: string, task?: Task): Promise<void>;
	/** Refreshes model options for providers that expose a model catalog. */
	refreshModels(settings: PluginSettings): Promise<AIModelOption[]>;
	/** Returns true when an optional provider can be loaded in the current runtime. */
	isProviderAvailable(tool: AITool): boolean;
	/** Marks a plan-ready record as rejected. */
	rejectPlan(planId: string): void;
	/** Opens the configured terminal app at the given vault path. */
	openTerminal(vaultPath: string, terminalApp: 'ghostty' | 'terminal'): void;
	/** Opens a directory in the configured IDE. */
	openIDE(cwd: string, ide: 'cursor' | 'vscode'): void;
	/** Kills all running dispatch processes. */
	killAll(): void;
}

// ---------------------------------------------------------------------------
// Pure functions (stateless, independently testable)
// ---------------------------------------------------------------------------

/** Returns true if an AI tool is configured in settings. */
export const isAIEnabled = (settings: PluginSettings): boolean =>
	settings.aiTool !== AI_TOOL.NONE;

/** Extracts a JSON array of strings from mixed AI output text via regex. */
export const parseJsonArray = (output: string): string[] | null => {
	const match = output.match(/\[[\s\S]*?\]/);
	if (match === null) return null;
	const items: string[] = [];
	const itemRegex = /"((?:[^"\\]|\\.)*)"/g;
	let matchResult: RegExpExecArray | null;
	while ((matchResult = itemRegex.exec(match[0])) !== null) {
		items.push(matchResult[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\'));
	}
	return items.length > 0 ? items : null;
};

/**
 * Reads all tasks, linked documents, and image paths into a single context object.
 * @param taskManager - Source for active and archived tasks
 * @param app - Obsidian app instance for vault file reads
 */
export const gatherContext = async (taskManager: TaskManager, app: App): Promise<AIContext> => {
	const tasks = taskManager.toJSON();
	const archivedTasks = taskManager.getArchivedTasks();

	const linkedDocContents = new Map<string, string>();
	const allTasks = [...tasks, ...archivedTasks];
	const seenPaths = new Set<string>();

	for (const task of allTasks) {
		for (const docPath of task.linkedDocs ?? []) {
			if (seenPaths.has(docPath)) continue;
			seenPaths.add(docPath);
			const file = app.vault.getAbstractFileByPath(docPath);
			if (file instanceof TFile) {
				const content = await app.vault.cachedRead(file);
				linkedDocContents.set(docPath, content);
			}
		}
	}

	const imagePaths: string[] = [];
	for (const task of allTasks) {
		for (const imgPath of task.images ?? []) {
			if (imagePaths.includes(imgPath) === false) {
				imagePaths.push(imgPath);
			}
		}
	}

	return { tasks, archivedTasks, linkedDocContents, imagePaths };
};

/**
 * Composes a markdown prompt from an action, context, and optional focus task.
 * @param action - The AI action to perform
 * @param context - Assembled task and document context
 * @param focusTask - Optional task to highlight in the prompt
 */
export const composePrompt = (action: AIAction, context: AIContext, focusTask?: Task): string => {
	const lines: string[] = [];
	lines.push(`# AI Task Action: ${action}`);
	lines.push('');
	lines.push(ACTION_INSTRUCTIONS[action]);
	lines.push('');

	if (focusTask) {
		lines.push('## Focus Task');
		lines.push(`- **Title**: ${focusTask.title}`);
		if (focusTask.description) {
			lines.push(`- **Description**: ${focusTask.description}`);
		}
		lines.push(`- **Duration**: ${focusTask.durationMinutes}m`);
		lines.push(`- **Status**: ${focusTask.status}`);
		if (focusTask.tags && focusTask.tags.length > 0) {
			lines.push(`- **Tags**: ${focusTask.tags.join(', ')}`);
		}
		if (focusTask.subtasks && focusTask.subtasks.length > 0) {
			lines.push(`- **Subtasks**: ${focusTask.subtasks.map((s) => `${s.status === 'completed' ? '[x]' : '[ ]'} ${s.title}`).join('; ')}`);
		}
		lines.push('');
	}

	lines.push('## All Tasks');
	for (const task of context.tasks) {
		const marker = task.id === focusTask?.id ? ' **(FOCUS)**' : '';
		lines.push(`- [${task.status}] ${task.title} (${task.durationMinutes}m)${marker}${task.tags?.length ? ` [${task.tags.join(', ')}]` : ''}`);
		if (task.description) lines.push(`  Description: ${task.description}`);
	}
	lines.push('');

	if (context.archivedTasks.length > 0) {
		lines.push('## Archived Tasks');
		for (const task of context.archivedTasks) {
			lines.push(`- ${task.title} (${task.durationMinutes}m)${task.tags?.length ? ` [${task.tags.join(', ')}]` : ''}`);
		}
		lines.push('');
	}

	if (context.linkedDocContents.size > 0) {
		lines.push('## Linked Document Contents');
		for (const [path, content] of context.linkedDocContents) {
			lines.push(`### ${path}`);
			lines.push('```');
			const truncated = content.length > 3000 ? content.substring(0, 3000) + '\n... (truncated)' : content;
			lines.push(truncated);
			lines.push('```');
			lines.push('');
		}
	}

	if (context.imagePaths.length > 0) {
		lines.push('## Attached Images');
		for (const imgPath of context.imagePaths) {
			lines.push(`- ${imgPath}`);
		}
		lines.push('');
	}

	return lines.join('\n');
};

// ---------------------------------------------------------------------------
// Module-level constants
// ---------------------------------------------------------------------------

/** Human-readable labels for each AI action. */
const ACTION_LABELS: Record<AIAction, string> = {
	organize: 'AI Organize',
	order: 'AI Auto-Order',
	'create-doc': 'AI Create Doc',
	delegate: 'AI Delegate',
};

/** Human-readable labels for configured AI providers. */
const AI_TOOL_LABELS: Record<AITool, string> = {
	[AI_TOOL.NONE]: 'None',
	[AI_TOOL.CURSOR_SDK]: 'Cursor SDK',
	[AI_TOOL.CODEX_CLI]: 'Codex CLI',
	[AI_TOOL.CLAUDE_CODE]: 'Claude Code',
	[AI_TOOL.OPENROUTER]: 'OpenRouter',
};

/** Default HTTPS endpoint used when no OpenRouter-compatible base URL is configured. */
const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

/** Maximum persisted provider error text retained in dispatch records. */
const MAX_PROVIDER_ERROR_TEXT_LENGTH = 4000;

/** Dispatch phases used to choose provider permissions and output handling. */
export const AI_DISPATCH_PHASE = {
	DISPATCH: 'dispatch',
	PLAN: 'plan',
	EXECUTE: 'execute',
} as const;

/** Runtime phase for a provider request. */
export type AIDispatchPhase = (typeof AI_DISPATCH_PHASE)[keyof typeof AI_DISPATCH_PHASE];

/** Callback invoked when the dispatch list changes. */
type DispatchListener = () => void;
/** Callback invoked when one dispatch reaches a terminal state. */
type DispatchFinishListener = (record: DispatchRecord) => void;

/** Prompt payload and execution paths shared by provider runners. */
interface PromptFileInfo {
	/** Absolute vault root used for terminal and IDE handoff. */
	vaultPath: string;
	/** Markdown prompt sent directly to the selected provider. */
	promptContent: string;
	/** Working directory used by local provider processes. */
	execCwd: string;
}

/** Provider output captured after a successful request. */
interface ProviderRunResult {
	/** Text returned by the provider for UI display or plan review. */
	output?: string;
}

/** Cursor SDK model selector accepted by the Agent API. */
interface CursorSdkModelSelection {
	/** Provider model identifier. */
	id: string;
}

/** Cursor SDK sandbox settings for local agent execution. */
interface CursorSdkSandboxOptions {
	/** Whether the SDK sandbox should block direct local changes. */
	enabled: boolean;
}

/** Cursor SDK local execution options. */
interface CursorSdkLocalOptions {
	/** Working directory where the SDK agent should run. */
	cwd?: string | string[];
	/** Sandbox control passed to the SDK during agent creation. */
	sandboxOptions?: CursorSdkSandboxOptions;
	/** Whether the SDK should skip its local confirmation prompt. */
	force?: boolean;
}

/** Cursor SDK agent creation arguments. */
interface CursorSdkAgentCreateOptions {
	/** API key loaded from the configured credential manager. */
	apiKey: string;
	/** Model selection for the agent session. */
	model?: CursorSdkModelSelection;
	/** Local filesystem execution settings. */
	local?: CursorSdkLocalOptions;
}

/** Cursor SDK prompt send options. */
interface CursorSdkSendOptions {
	/** Model override for this prompt. */
	model?: CursorSdkModelSelection;
	/** Local execution controls for this prompt. */
	local?: CursorSdkLocalOptions;
}

/** Cursor SDK terminal status returned by a completed run. */
interface CursorSdkRunResult {
	/** Provider status such as finished, failed, or canceled. */
	status: string;
	/** Text result returned by the agent. */
	result?: string;
}

/** Cursor SDK run handle that resolves when the provider completes. */
interface CursorSdkRun {
	/** Waits for the current SDK run to finish. */
	wait(): Promise<CursorSdkRunResult>;
}

/** Cursor SDK agent instance used for prompt dispatch. */
interface CursorSdkAgent {
	/** Sends one prompt to the agent. */
	send(prompt: string, options?: CursorSdkSendOptions): Promise<CursorSdkRun>;
	/** Releases any SDK resources associated with the agent. */
	close?(): void;
}

/** Cursor SDK agent factory exported by @cursor/sdk. */
interface CursorSdkAgentFactory {
	/** Creates a local Cursor agent using a Keychain-backed API key. */
	create(options: CursorSdkAgentCreateOptions): Promise<CursorSdkAgent>;
}

/** Cursor SDK model catalog record. */
interface CursorSdkModelRecord {
	/** Provider model identifier. */
	id: string;
	/** Optional display name returned by Cursor. */
	displayName?: string;
	/** Optional provider aliases for the same model. */
	aliases?: string[];
}

/** Cursor SDK model catalog API. */
interface CursorSdkModelsApi {
	/** Lists models available to the configured account. */
	list(options: { apiKey: string }): Promise<CursorSdkModelRecord[]>;
}

/** Cursor SDK namespace containing model APIs. */
interface CursorSdkCursorNamespace {
	/** Model catalog methods. */
	models: CursorSdkModelsApi;
}

/** Minimal shape consumed from the optional @cursor/sdk package. */
interface CursorSdkModule {
	/** Agent constructor namespace. */
	Agent: CursorSdkAgentFactory;
	/** Cursor service namespace. */
	Cursor: CursorSdkCursorNamespace;
}

/** Returns a human-readable label for UI notices. */
const getAIToolLabel = (tool: AITool): string => AI_TOOL_LABELS[tool] ?? tool;

/** Provider-facing instructions for each supported AI task action. */
const ACTION_INSTRUCTIONS: Record<AIAction, string> = {
	organize: 'Analyze this task and suggest appropriate tags and timeline position relative to the other tasks. Return a JSON object with { tags: string[], insertAfterTaskId: string | null }.',
	order: 'Reorder these pending tasks by priority, dependency, and logical flow. Return a JSON array of task IDs in the optimal order.',
	'create-doc': 'Create a comprehensive document for this task based on the provided context. Output the document content in markdown format.',
	delegate: 'Execute the following task. The description below is your primary instruction.',
};

/** Delegate instruction used during review-only plan generation. */
const PLAN_PHASE_INSTRUCTION = 'Analyze this task and produce a detailed step-by-step execution plan. Describe exactly what you will do, which files you will touch, and the expected outcome. Do NOT execute anything yet -- only output the plan.';

/** Prefix that turns an approved plan into an execution prompt. */
const EXECUTE_PHASE_PREFIX = 'The user has reviewed and approved the following execution plan. Proceed to execute it exactly as described.\n\n## Approved Plan\n';

/** Sanitizes a string into a filesystem-safe slug. */
const toSlug = (value: string): string =>
	value.substring(0, 60).replace(/[\\/:*?"<>|#^[\]]/g, '-').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'untitled';

/** Only allows safe filesystem path characters -- no shell metacharacters. */
const SAFE_PATH_RE = /^[a-zA-Z0-9_/.\-~]+$/;

/** Returns true when Node APIs are available inside Obsidian desktop. */
const isDesktopNodeRuntime = (): boolean =>
	typeof process !== 'undefined' && process.versions?.node !== undefined && typeof require === 'function';

/** Returns true if the AI tool path contains only safe filesystem characters. */
export const validateToolPath = (path: string): boolean =>
	path === '' || SAFE_PATH_RE.test(path);

/** Redacts common secret-bearing headers, env vars, and token shapes from provider text. */
export const redactSensitiveText = (value: string): string =>
	value
		.replace(/(Authorization\s*:\s*Bearer\s+)[^\s"'\\]+/gi, '$1[redacted]')
		.replace(/\b(OPENAI_API_KEY|ANTHROPIC_API_KEY|api[_-]?key|token|password|secret)\b\s*[:=]\s*["']?[^"'\s,}]+/gi, '$1=[redacted]')
		.replace(/\b(sk-[A-Za-z0-9_-]{16,})\b/g, '[redacted-api-key]');

/** Caps provider error text so failed dispatch records cannot retain large response bodies. */
export const truncateProviderText = (value: string, maxLength = MAX_PROVIDER_ERROR_TEXT_LENGTH): string => {
	if (value.length <= maxLength) return value;
	return `${value.substring(0, maxLength)}\n... (truncated)`;
};

/** Applies redaction and size limits to text stored or logged from provider failures. */
export const sanitizeProviderText = (value: string): string =>
	truncateProviderText(redactSensitiveText(value).trim());

/** Validates and normalizes an OpenRouter-compatible HTTPS base URL before API keys are sent. */
export const normalizeOpenRouterBaseUrl = (value: string): string => {
	const rawValue = value.trim() || DEFAULT_OPENROUTER_BASE_URL;
	let parsedUrl: URL;
	try {
		parsedUrl = new URL(rawValue);
	} catch {
		throw new Error('OpenRouter base URL must be a valid HTTPS URL.');
	}

	if (parsedUrl.protocol !== 'https:') {
		throw new Error('OpenRouter base URL must use HTTPS.');
	}
	if (parsedUrl.username !== '' || parsedUrl.password !== '') {
		throw new Error('OpenRouter base URL cannot include credentials.');
	}
	if (parsedUrl.search !== '' || parsedUrl.hash !== '') {
		throw new Error('OpenRouter base URL cannot include query strings or fragments.');
	}

	return parsedUrl.toString().replace(/\/+$/, '');
};

/**
 * Resolves a CLI tool name to its full path via the user's login shell.
 * GUI apps (like Obsidian) don't inherit terminal PATH, so bare command
 * names fail. Falls back to the tool name itself if resolution fails.
 */
const resolveCommand = (tool: string): string => {
	const { spawnSync } = require('child_process') as typeof import('child_process');
	const userShell = process.env.SHELL || '/bin/zsh';
	const result = spawnSync(userShell, ['-lic', `which '${tool}'`], { timeout: 5000, encoding: 'utf-8' });
	return result.status === 0 ? (result.stdout as string).trim() || tool : tool;
};

/** Fire-and-forget spawn a process detached from Obsidian's lifecycle. */
const launchDetached = (command: string, args: string[]): void => {
	const { spawn } = require('child_process') as typeof import('child_process');
	spawn(command, args, { detached: true, stdio: 'ignore' });
};

// ---------------------------------------------------------------------------
// Concrete implementation (spawn-based dispatch via child_process)
// ---------------------------------------------------------------------------

/**
 * CLI-based implementation of IAIDispatcher.
 * Writes prompts to vault files and executes them via Cursor or Claude Code CLI.
 * Uses spawn() with explicit argv to prevent shell injection.
 */
export class AIDispatcher implements IAIDispatcher {

	/** Maximum number of provider requests allowed to run concurrently. */
	private static readonly MAX_CONCURRENT = 3;

	/** Dispatch records keyed by their persisted string identifiers. */
	private dispatches = new Map<string, DispatchRecord>();
	/** Subscribers notified whenever dispatch records change. */
	private listeners: DispatchListener[] = [];
	/** Subscribers notified when a dispatch reaches a terminal status. */
	private finishListeners: DispatchFinishListener[] = [];
	/** Monotonic ID counter used for new dispatch records. */
	private nextId = 1;
	/** Active provider request count, including SDK/fetch requests without child processes. */
	private activeDispatchCount = 0;
	/** Child processes that can be terminated from plugin unload or user action. */
	private activeProcesses = new Set<{ kill(signal?: NodeJS.Signals | number): boolean }>();

	/**
	 * Loads persisted dispatch entries back into the in-memory map.
	 * Running entries that weren't completed are marked as failed since
	 * the process is gone after a restart.
	 */
	hydrate(entries: DispatchHistoryEntry[]): void {
		for (const entry of entries) {
			const record: DispatchRecord = {
				...entry,
				action: entry.action as AIAction,
				output: undefined,
			};
			if (record.status === 'running' || record.status === 'plan-pending') {
				record.status = 'failed';
				record.endTime = record.endTime ?? Date.now();
				record.error = 'Process lost on reload';
			}
			this.dispatches.set(record.id, record);
			const numericId = parseInt(record.id, 10);
			if (Number.isNaN(numericId) === false && numericId >= this.nextId) {
				this.nextId = numericId + 1;
			}
		}
		this.notifyListeners();
	}

	/** Serializes current dispatch records for disk persistence. */
	toJSON(): DispatchHistoryEntry[] {
		return [...this.dispatches.values()].map((record) => ({
			id: record.id,
			action: record.action,
			label: record.label,
			taskId: record.taskId,
			taskTitle: record.taskTitle,
			tool: record.tool,
			status: record.status,
			startTime: record.startTime,
			endTime: record.endTime,
			error: record.error,
			vaultPath: record.vaultPath,
			planText: record.planText,
			parentPlanId: record.parentPlanId,
		}));
	}

	/** Clears all dispatch records regardless of status. */
	clearAll(): void {
		this.dispatches.clear();
		this.notifyListeners();
	}

	/** Removes a single dispatch record by ID. */
	removeRecord(id: string): void {
		if (this.dispatches.delete(id)) {
			this.notifyListeners();
		}
	}

	/** Subscribe to dispatch list changes. Returns an unsubscribe function. */
	onDispatchChange(fn: DispatchListener): () => void {
		this.listeners.push(fn);
		return () => { this.listeners = this.listeners.filter((l) => l !== fn); };
	}

	/** Subscribe to dispatch finish events (completed or failed). Returns an unsubscribe function. */
	onDispatchFinish(fn: DispatchFinishListener): () => void {
		this.finishListeners.push(fn);
		return () => { this.finishListeners = this.finishListeners.filter((l) => l !== fn); };
	}

	/** Notifies all finish listeners that a dispatch has completed or failed. */
	private notifyFinish(record: DispatchRecord): void {
		for (const fn of this.finishListeners) fn(record);
	}

	/** Notifies all change listeners that the dispatch list has been modified. */
	private notifyListeners(): void {
		for (const fn of this.listeners) fn();
	}

	/** Returns all dispatch records, newest first. */
	getDispatches(): DispatchRecord[] {
		return [...this.dispatches.values()].sort((a, b) => b.startTime - a.startTime);
	}

	/** Clears completed/failed records from the list. */
	clearFinished(): void {
		const keepStatuses: DispatchStatus[] = ['running', 'plan-pending', 'plan-ready'];
		for (const [id, record] of this.dispatches) {
			if (keepStatuses.includes(record.status) === false) this.dispatches.delete(id);
		}
		this.notifyListeners();
	}

	/**
	 * Writes the prompt to a temp vault file and executes the configured AI provider.
	 */
	async dispatch(app: App, settings: PluginSettings, action: AIAction, prompt: string, task?: Task): Promise<string> {
		if (this.canStartDispatch(settings) === false) return '';
		const promptInfo = await this.writePromptFile(app, settings, prompt, task);

		const actionLabel = ACTION_LABELS[action];
		const recordId = String(this.nextId++);
		const record: DispatchRecord = {
			id: recordId,
			action,
			label: task ? `${actionLabel}: ${task.title}` : actionLabel,
			taskId: task?.id ?? '',
			taskTitle: task?.title ?? '',
			tool: settings.aiTool,
			status: 'running',
			startTime: Date.now(),
			vaultPath: promptInfo.vaultPath,
		};
		this.dispatches.set(recordId, record);
		this.notifyListeners();

		new Notice(`${actionLabel}: running ${getAIToolLabel(settings.aiTool)}...`);
		const success = await this.runProviderIntoRecord(settings, promptInfo, record, actionLabel);
		return success ? recordId : '';
	}

	/**
	 * Phase 1 of the delegate flow: dispatches a plan-generation prompt that
	 * asks the AI to describe what it will do without executing. The returned
	 * record ID can be watched via `onDispatchChange` until `status` flips to
	 * `'plan-ready'` (stdout captured in `planText`).
	 *
	 * Always uses `--print` / non-interactive mode so stdout is captured.
	 */
	async dispatchPlan(app: App, settings: PluginSettings, context: AIContext, task: Task): Promise<string> {
		if (this.canStartDispatch(settings) === false) return '';
		const planPrompt = this.composePlanPrompt(context, task);
		const promptInfo = await this.writePromptFile(app, settings, planPrompt, task);

		const recordId = String(this.nextId++);
		const record: DispatchRecord = {
			id: recordId,
			action: 'delegate',
			label: `AI Plan: ${task.title}`,
			taskId: task.id,
			taskTitle: task.title,
			tool: settings.aiTool,
			status: 'plan-pending',
			startTime: Date.now(),
			vaultPath: promptInfo.vaultPath,
		};
		this.dispatches.set(recordId, record);
		this.notifyListeners();

		new Notice(`AI Plan: generating plan via ${getAIToolLabel(settings.aiTool)}...`);
		void this.runPlanIntoRecord(settings, promptInfo, record);

		return recordId;
	}

	/**
	 * Phase 2: executes the approved plan by reusing the same dispatch record.
	 * Transitions the plan record from plan-ready -> running -> completed/failed
	 * so only a single row appears in the sidebar for the entire plan+execute flow.
	 */
	async dispatchExecute(app: App, settings: PluginSettings, planId: string, task?: Task): Promise<void> {
		const planRecord = this.dispatches.get(planId);
		if (planRecord === undefined || planRecord.status !== 'plan-ready' || planRecord.planText === undefined) {
			new Notice('No approved plan found.');
			return;
		}
		if (this.canStartDispatch(settings) === false) return;
		if (settings.aiTool === AI_TOOL.OPENROUTER) {
			this.failRecord(
				planRecord,
				'OpenRouter can generate plans but cannot execute local file or shell changes. Choose Cursor SDK, Codex CLI, or Claude Code to execute.',
				'AI Execute failed.',
			);
			return;
		}

		const executePrompt = EXECUTE_PHASE_PREFIX + planRecord.planText;
		const promptInfo = await this.writePromptFile(app, settings, executePrompt, task);

		planRecord.label = `AI Execute: ${planRecord.taskTitle}`;
		planRecord.status = 'running';
		planRecord.endTime = undefined;
		planRecord.error = undefined;
		planRecord.output = undefined;
		this.notifyListeners();

		new Notice(`AI Execute: running ${getAIToolLabel(settings.aiTool)}...`);
		await this.runProviderIntoRecord(settings, promptInfo, planRecord, 'AI Execute', AI_DISPATCH_PHASE.EXECUTE);
	}

	/** Marks a plan-ready record as rejected. */
	rejectPlan(planId: string): void {
		const record = this.dispatches.get(planId);
		if (record === undefined || record.status !== 'plan-ready') return;
		record.status = 'plan-rejected';
		record.endTime = Date.now();
		this.notifyListeners();
		new Notice('AI Plan rejected.');
	}

	/** Returns a specific dispatch record by ID. */
	getRecord(id: string): DispatchRecord | undefined {
		return this.dispatches.get(id);
	}

	/** Refreshes provider model options when the selected provider exposes a catalog. */
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
			throw this.providerError(error);
		}
	}

	/** Returns false for optional providers whose runtime package is absent. */
	isProviderAvailable(tool: AITool): boolean {
		if (tool !== AI_TOOL.CURSOR_SDK) {
			return tool !== AI_TOOL.NONE;
		}
		try {
			return this.optionalCursorSdk() !== undefined;
		} catch {
			return false;
		}
	}

	/**
	 * Opens a terminal window at the given path.
	 * Ghostty requires its CLI with --working-directory; Terminal.app handles
	 * folder arguments from `open -a` natively.
	 */
	openTerminal(vaultPath: string, terminalApp: 'ghostty' | 'terminal'): void {
		if (terminalApp === 'ghostty') {
			launchDetached(resolveCommand('ghostty'), ['--working-directory=' + vaultPath]);
		} else {
			launchDetached('open', ['-a', 'Terminal', vaultPath]);
		}
	}

	/** Opens a directory in the configured IDE via its CLI command. */
	openIDE(cwd: string, ide: 'cursor' | 'vscode'): void {
		const tool = ide === 'cursor' ? 'cursor' : 'code';
		launchDetached(resolveCommand(tool), [cwd]);
	}

	/** Sends SIGTERM to all tracked child processes. */
	killAll(): void {
		for (const processHandle of this.activeProcesses) {
			processHandle.kill('SIGTERM');
		}
		this.activeProcesses.clear();
	}

	/**
	 * Composes a plan-phase prompt that reuses the standard context layout
	 * but swaps in the plan-generation instruction instead of the delegate one.
	 */
	private composePlanPrompt(context: AIContext, focusTask: Task): string {
		const saved = ACTION_INSTRUCTIONS['delegate'];
		ACTION_INSTRUCTIONS['delegate'] = PLAN_PHASE_INSTRUCTION;
		const prompt = composePrompt('delegate', context, focusTask);
		ACTION_INSTRUCTIONS['delegate'] = saved;
		return prompt;
	}

	/** Validates provider availability, concurrency, and local executable paths before work starts. */
	private canStartDispatch(settings: PluginSettings): boolean {
		if (settings.aiTool === AI_TOOL.NONE) {
			new Notice('No AI tool configured. Set one in Settings > AI.');
			return false;
		}
		if (isDesktopNodeRuntime() === false) {
			new Notice('AI dispatch requires Obsidian desktop because provider credentials are stored in macOS Keychain.');
			return false;
		}
		if (settings.aiTool === AI_TOOL.CURSOR_SDK && this.isProviderAvailable(AI_TOOL.CURSOR_SDK) === false) {
			new Notice('Cursor SDK is not installed in this plugin folder. Select another AI provider or install @cursor/sdk locally.');
			return false;
		}
		if (this.activeDispatchCount >= AIDispatcher.MAX_CONCURRENT) {
			new Notice(`Max concurrent dispatches (${AIDispatcher.MAX_CONCURRENT}) reached. Wait for one to finish.`);
			return false;
		}
		if (settings.aiTool === AI_TOOL.CODEX_CLI && validateToolPath(settings.aiProviders.codexCli.cliPath) === false) {
			new Notice('Codex CLI path contains invalid characters. Check Settings > AI.');
			return false;
		}
		if (settings.aiTool === AI_TOOL.CLAUDE_CODE && validateToolPath(settings.aiProviders.claudeCode.cliPath) === false) {
			new Notice('Claude Code CLI path contains invalid characters. Check Settings > AI.');
			return false;
		}
		return true;
	}

	/** Writes the prompt note used for auditability and returns local execution paths. */
	private async writePromptFile(app: App, settings: PluginSettings, prompt: string, task?: Task): Promise<PromptFileInfo> {
		const slug = task ? toSlug(task.title) : '_general';
		const folder = normalizePath(`${settings.outputFolder}/dispatches/${slug}`);
		await ensureVaultFolder(app, folder);
		const tempPath = normalizePath(`${folder}/prompt.md`);
		const existing = app.vault.getAbstractFileByPath(tempPath);
		if (existing instanceof TFile) {
			await app.vault.modify(existing, prompt);
		} else {
			await app.vault.create(tempPath, prompt);
		}

		const vaultPath = (app.vault.adapter as { basePath?: string }).basePath ?? '';
		return {
			vaultPath,
			promptContent: prompt,
			execCwd: this.resolveWorkingDirectory(vaultPath, task),
		};
	}

	/** Runs a provider request and updates the dispatch record through success or failure. */
	private async runProviderIntoRecord(
		settings: PluginSettings,
		promptInfo: PromptFileInfo,
		record: DispatchRecord,
		successLabel: string,
		phase: AIDispatchPhase = AI_DISPATCH_PHASE.DISPATCH,
	): Promise<boolean> {
		this.trackDispatchStart();
		try {
			const result = await this.runSelectedProvider(settings, promptInfo, phase);
			record.status = 'completed';
			record.endTime = Date.now();
			record.output = result.output;
			this.notifyListeners();
			this.notifyFinish(record);
			new Notice(`${successLabel} complete.`);
			return true;
		} catch (error) {
			this.failRecord(record, this.errorMessage(error), `${successLabel} failed.`);
			console.error('[AIDispatcher] provider dispatch failed:', this.errorMessage(error));
			return false;
		} finally {
			this.trackDispatchEnd();
		}
	}

	/** Runs a plan-phase request and stores the plan text for explicit approval. */
	private async runPlanIntoRecord(settings: PluginSettings, promptInfo: PromptFileInfo, record: DispatchRecord): Promise<void> {
		this.trackDispatchStart();
		try {
			const result = await this.runSelectedProvider(settings, promptInfo, AI_DISPATCH_PHASE.PLAN);
			const output = (result.output ?? '').trim();
			if (output.length === 0) {
				throw new Error('AI returned empty plan. Check that the provider is configured and accessible.');
			}
			record.status = 'plan-ready';
			record.endTime = Date.now();
			record.planText = output;
			record.output = result.output;
			this.notifyListeners();
			new Notice('AI Plan ready -- review and approve.');
		} catch (error) {
			this.failRecord(record, this.errorMessage(error), 'AI Plan failed.');
			console.error('[AIDispatcher] plan phase error:', this.errorMessage(error));
		} finally {
			this.trackDispatchEnd();
		}
	}

	/** Marks a record as failed while storing only sanitized diagnostic text. */
	private failRecord(record: DispatchRecord, message: string, notice: string, output?: string): void {
		record.status = 'failed';
		record.endTime = Date.now();
		record.error = sanitizeProviderText(message);
		record.output = output === undefined ? undefined : sanitizeProviderText(output);
		this.notifyListeners();
		this.notifyFinish(record);
		new Notice(notice);
	}

	/** Routes a prompt to the selected provider implementation. */
	private async runSelectedProvider(
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

	/** Runs a local CLI provider with explicit argv and provider-specific environment variables. */
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
		const env = await this.providerEnv(settings, tool);
		const output = await this.spawnAndCapture(toolPath, args, promptInfo.execCwd, env);
		return { output };
	}

	/** Builds local CLI arguments while only using dangerous bypass flags when explicitly enabled. */
	private buildCliArgs(
		settings: PluginSettings,
		tool: typeof AI_TOOL.CODEX_CLI | typeof AI_TOOL.CLAUDE_CODE,
		phase: AIDispatchPhase,
		promptContent: string,
	): string[] {
		if (tool === AI_TOOL.CODEX_CLI) {
			const args = ['exec', '-C', '.', '--ask-for-approval', 'never'];
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

	/** Builds an environment for local providers, adding API key overrides only when configured. */
	private async providerEnv(
		settings: PluginSettings,
		tool: typeof AI_TOOL.CODEX_CLI | typeof AI_TOOL.CLAUDE_CODE,
	): Promise<NodeJS.ProcessEnv> {
		const env: NodeJS.ProcessEnv = { ...process.env };
		if (tool === AI_TOOL.CODEX_CLI) {
			const apiKey = await getKeychainSecret(settings.aiProviders.codexCli.apiKey);
			if (apiKey) env.OPENAI_API_KEY = apiKey;
		} else {
			const apiKey = await getKeychainSecret(settings.aiProviders.claudeCode.apiKey);
			if (apiKey) env.ANTHROPIC_API_KEY = apiKey;
		}
		return env;
	}

	/** Spawns a local provider process without a shell and captures its standard output. */
	private spawnAndCapture(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<string> {
		return new Promise((resolve, reject) => {
			const { spawn } = require('child_process') as typeof import('child_process');
			const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
			this.trackProcess(child);

			const standardOutputChunks: Buffer[] = [];
			const standardErrorChunks: Buffer[] = [];
			child.stdout.on('data', (chunk: Buffer) => standardOutputChunks.push(chunk));
			child.stderr.on('data', (chunk: Buffer) => standardErrorChunks.push(chunk));
			child.on('error', (error: Error) => {
				this.untrackProcess(child);
				reject(error);
			});
			child.on('close', (code: number | null) => {
				this.untrackProcess(child);
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

	/** Builds a sanitized local-process failure message without retaining raw provider stderr indefinitely. */
	private providerProcessError(code: number | null, standardOutput: string, standardError: string): string {
		const message = [`Process exited with code ${code ?? 'unknown'}`, standardOutput, standardError]
			.filter((part) => part.trim().length > 0)
			.join('\n');
		return sanitizeProviderText(message);
	}

	/** Runs the OpenRouter chat completion endpoint for plan or analysis output. */
	private async runOpenRouter(settings: PluginSettings, promptInfo: PromptFileInfo): Promise<ProviderRunResult> {
		const apiKey = await this.requireApiKey(settings.aiProviders.openRouter.apiKey, 'OpenRouter');
		const model = this.resolveOpenRouterModel(settings);
		const baseUrl = this.openRouterBaseUrl(settings);
		const response = await fetch(`${baseUrl}/chat/completions`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${apiKey}`,
				'Content-Type': 'application/json',
				'HTTP-Referer': 'https://github.com/dudetru25/vault-dashboard',
				'X-Title': 'Vault Dashboard',
			},
			body: JSON.stringify({
				model,
				messages: [{ role: 'user', content: promptInfo.promptContent }],
				stream: false,
			}),
		});
		if (response.ok === false) {
			throw new Error(await this.responseError(response, 'OpenRouter chat request failed'));
		}
		const data = await response.json() as unknown;
		return { output: this.extractOpenRouterText(data) };
	}

	/** Lists Cursor SDK models using the optional SDK package when available. */
	private async listCursorModels(settings: PluginSettings): Promise<AIModelOption[]> {
		const apiKey = await this.requireApiKey(settings.aiProviders.cursorSdk.apiKey, 'Cursor SDK');
		const sdk = this.loadCursorSdk();
		const models = await sdk.Cursor.models.list({ apiKey });
		return models.map((model) => ({
			id: model.id,
			name: model.displayName ?? model.id,
		}));
	}

	/** Lists OpenRouter models available to the saved API key. */
	private async listOpenRouterModels(settings: PluginSettings): Promise<AIModelOption[]> {
		const apiKey = await this.requireApiKey(settings.aiProviders.openRouter.apiKey, 'OpenRouter');
		const response = await fetch(`${this.openRouterBaseUrl(settings)}/models/user`, {
			headers: {
				Authorization: `Bearer ${apiKey}`,
				Accept: 'application/json',
				'HTTP-Referer': 'https://github.com/dudetru25/vault-dashboard',
				'X-Title': 'Vault Dashboard',
			},
		});
		if (response.ok === false) {
			throw new Error(await this.responseError(response, 'OpenRouter model refresh failed'));
		}
		const data = await response.json() as unknown;
		const record = this.asRecord(data);
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

	/** Loads a provider API key from Keychain and reports a setup-focused error when absent. */
	private async requireApiKey(ref: PluginSettings['aiProviders']['cursorSdk']['apiKey'], label: string): Promise<string> {
		const apiKey = await getKeychainSecret(ref);
		if (apiKey === undefined) {
			throw new Error(`${label} API key not found in macOS Keychain. Save it in Settings > AI Integration.`);
		}
		return apiKey;
	}

	/** Resolves the OpenRouter model from explicit selection or the first cached catalog item. */
	private resolveOpenRouterModel(settings: PluginSettings): string {
		const configured = settings.aiProviders.openRouter.model.trim();
		if (configured.length > 0) return configured;
		const cached = settings.aiProviders.openRouter.models[0]?.id;
		if (cached) return cached;
		throw new Error('No OpenRouter model selected. Refresh models and choose one in Settings > AI Integration.');
	}

	/** Returns a validated OpenRouter-compatible base URL before attaching Authorization headers. */
	private openRouterBaseUrl(settings: PluginSettings): string {
		return normalizeOpenRouterBaseUrl(settings.aiProviders.openRouter.baseUrl);
	}

	/** Loads the optional Cursor SDK package or throws a user-actionable configuration error. */
	private loadCursorSdk(): CursorSdkModule {
		const module = this.optionalCursorSdk();
		if (module === undefined) {
			throw new Error('Cursor SDK is not installed in this plugin folder. Install @cursor/sdk locally or select a different AI provider.');
		}
		return module;
	}

	/** Attempts to load @cursor/sdk without making it a required production dependency. */
	private optionalCursorSdk(): CursorSdkModule | undefined {
		try {
			const module = require('@cursor/sdk') as unknown;
			return this.parseCursorSdkModule(module);
		} catch (error) {
			if (this.isMissingCursorSdk(error)) return undefined;
			throw error;
		}
	}

	/** Validates the minimal runtime shape consumed from @cursor/sdk. */
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
			Cursor: { models: { list: modelsNamespace.list as CursorSdkModelsApi['list'] } },
		};
	}

	/** Returns true only for the top-level missing optional Cursor SDK package. */
	private isMissingCursorSdk(error: unknown): boolean {
		const record = this.asRecord(error);
		const message = error instanceof Error ? error.message : String(error);
		return record.code === 'MODULE_NOT_FOUND' && message.includes('@cursor/sdk');
	}

	/** Extracts assistant text from the OpenRouter chat completion response shape. */
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

	/** Builds a redacted failure message from a non-2xx provider response. */
	private async responseError(response: Response, fallback: string): Promise<string> {
		const contentLength = Number(response.headers.get('content-length') ?? 0);
		if (contentLength > MAX_PROVIDER_ERROR_TEXT_LENGTH) {
			return `${fallback}: ${response.status} response body omitted (${contentLength} bytes)`;
		}
		const text = await response.text();
		const message = text.trim().length > 0 ? `${fallback}: ${response.status} ${text}` : `${fallback}: ${response.status}`;
		return sanitizeProviderText(message);
	}

	/** Converts provider errors into safe user-facing dispatch messages. */
	private errorMessage(error: unknown): string {
		const record = this.asRecord(error);
		if (record.status === 401 || record.name === 'AuthenticationError') {
			return 'AI provider rejected the API key. Re-enter a valid key in Settings > AI Integration.';
		}
		const message = error instanceof Error ? error.message : String(error);
		if (message.trim().length > 0 && message !== 'Error') return sanitizeProviderText(message);
		const operation = typeof record.operation === 'string' ? record.operation : '';
		return operation.length > 0 ? `${operation} failed.` : 'AI provider request failed.';
	}

	/** Wraps provider errors while preserving sanitized text for settings refresh flows. */
	private providerError(error: unknown): Error {
		return new Error(this.errorMessage(error));
	}

	/** Safely treats unknown provider data as an object record. */
	private asRecord(value: unknown): Record<string, unknown> {
		return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
	}

	/** Resolves the effective working directory from task or vault root. */
	private resolveWorkingDirectory(vaultPath: string, task?: Task): string {
		return task?.workingDirectory || vaultPath;
	}

	/** Increments the provider concurrency counter before async work starts. */
	private trackDispatchStart(): void {
		this.activeDispatchCount++;
	}

	/** Decrements the provider concurrency counter after async work finishes. */
	private trackDispatchEnd(): void {
		this.activeDispatchCount = Math.max(0, this.activeDispatchCount - 1);
	}

	/** Adds a spawned process to the active set for lifecycle tracking. */
	private trackProcess(processHandle: { kill(signal?: NodeJS.Signals | number): boolean }): void {
		this.activeProcesses.add(processHandle);
	}

	/** Removes a finished process from the active set. */
	private untrackProcess(processHandle: { kill(signal?: NodeJS.Signals | number): boolean }): void {
		this.activeProcesses.delete(processHandle);
	}
}
