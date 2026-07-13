/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vaultboard
 * Description: Stateful AI dispatch lifecycle with compatibility exports for prompt and provider helpers
 * Created: 2026-03-08
 * Last Modified: 2026-07-12
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
import { ensureVaultFolder } from './VaultUtils';
import { AI_DISPATCH_PHASE, type AIDispatchPhase } from './ai/AIDispatchPhase';
import type { AIAction } from './ai/AIAction';
import type { AIContext } from './ai/AIContext';
import type { DispatchRecord } from './ai/DispatchRecord';
import type { IAIDispatcher } from './ai/IAIDispatcher';
import {
	composePlanPrompt,
	EXECUTE_PHASE_PREFIX,
	toPromptSlug,
} from './ai/PromptComposer';
import type { PromptFileInfo } from './ai/PromptFileInfo';
import { ProviderRunner } from './ai/ProviderRunner';
import type { ProviderRunResult } from './ai/ProviderRunResult';
import {
	isDesktopNodeRuntime,
	sanitizeProviderText,
	validateToolPath,
} from './ai/ProviderSecurity';

export { AI_DISPATCH_PHASE } from './ai/AIDispatchPhase';
export type { AIDispatchPhase } from './ai/AIDispatchPhase';
export type { AIAction } from './ai/AIAction';
export type { AIContext } from './ai/AIContext';
export type { DispatchRecord } from './ai/DispatchRecord';
export type { IAIDispatcher } from './ai/IAIDispatcher';
export { composePrompt, gatherContext } from './ai/PromptComposer';
export {
	normalizeOpenRouterBaseUrl,
	redactSensitiveText,
	sanitizeProviderText,
	truncateProviderText,
	validateToolPath,
} from './ai/ProviderSecurity';

/** Human-readable labels for task operations shown in dispatch notices. */
const ACTION_LABELS: Record<AIAction, string> = {
	organize: 'AI Organize',
	order: 'AI Auto-Order',
	'create-doc': 'AI Create Doc',
	delegate: 'AI Delegate',
};

/** Human-readable labels for configured providers shown in dispatch notices. */
const AI_TOOL_LABELS: Record<AITool, string> = {
	[AI_TOOL.NONE]: 'None',
	[AI_TOOL.CURSOR_SDK]: 'Cursor SDK',
	[AI_TOOL.CODEX_CLI]: 'Codex CLI',
	[AI_TOOL.CLAUDE_CODE]: 'Claude Code',
	[AI_TOOL.OPENROUTER]: 'OpenRouter',
};

/** Listener notified when the dispatch collection changes. */
type DispatchListener = () => void;

/** Listener notified when a dispatch reaches a terminal state. */
type DispatchFinishListener = (record: DispatchRecord) => void;

/** Returns the stable display label for a configured provider. */
const getAIToolLabel = (tool: AITool): string => AI_TOOL_LABELS[tool] ?? tool;

/** Returns true when any AI provider is selected in settings. */
export const isAIEnabled = (settings: PluginSettings): boolean =>
	settings.aiTool !== AI_TOOL.NONE;

/** Extracts the first JSON-like string array embedded in mixed provider output. */
export const parseJsonArray = (output: string): string[] | null => {
	const match = output.match(/\[[\s\S]*?\]/);
	if (match === null) return null;
	const items: string[] = [];
	const itemPattern = /"((?:[^"\\]|\\.)*)"/g;
	let matchResult: RegExpExecArray | null;
	while ((matchResult = itemPattern.exec(match[0])) !== null) {
		items.push(matchResult[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\'));
	}
	return items.length > 0 ? items : null;
};

/**
 * Owns dispatch state, persistence, approval transitions, and user notifications.
 * Provider integration is delegated to ProviderRunner so this class stays focused
 * on the lifecycle consumed by dashboard views.
 */
export class AIDispatcher implements IAIDispatcher {
	/** Maximum provider requests allowed to run concurrently. */
	private static readonly MAX_CONCURRENT = 3;

	/** Provider execution boundary shared by every dispatch lifecycle operation. */
	private readonly providerRunner = new ProviderRunner();
	/** Dispatch records keyed by their persisted identifiers. */
	private dispatches = new Map<string, DispatchRecord>();
	/** Subscribers notified whenever dispatch records change. */
	private listeners: DispatchListener[] = [];
	/** Subscribers notified when a dispatch reaches a terminal status. */
	private finishListeners: DispatchFinishListener[] = [];
	/** Monotonic identifier counter used for new dispatch records. */
	private nextId = 1;
	/** Active provider request count, including SDK and HTTP requests. */
	private activeDispatchCount = 0;

	/**
	 * Restores persisted dispatches and marks interrupted work as failed because
	 * its original provider process cannot survive an Obsidian restart.
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

	/** Serializes dispatch state while excluding runtime-only provider output. */
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

	/** Clears all dispatch records and informs collection subscribers. */
	clearAll(): void {
		this.dispatches.clear();
		this.notifyListeners();
	}

	/** Removes one dispatch record when its identifier exists. */
	removeRecord(id: string): void {
		if (this.dispatches.delete(id)) {
			this.notifyListeners();
		}
	}

	/** Subscribes to collection changes and returns an unsubscribe function. */
	onDispatchChange(listener: DispatchListener): () => void {
		this.listeners.push(listener);
		return () => { this.listeners = this.listeners.filter((item) => item !== listener); };
	}

	/** Subscribes to terminal dispatch events and returns an unsubscribe function. */
	onDispatchFinish(listener: DispatchFinishListener): () => void {
		this.finishListeners.push(listener);
		return () => { this.finishListeners = this.finishListeners.filter((item) => item !== listener); };
	}

	/** Returns dispatch records sorted from newest to oldest. */
	getDispatches(): DispatchRecord[] {
		return [...this.dispatches.values()].sort((first, second) => second.startTime - first.startTime);
	}

	/** Returns a dispatch record without copying its live lifecycle state. */
	getRecord(id: string): DispatchRecord | undefined {
		return this.dispatches.get(id);
	}

	/** Removes terminal records while retaining work that still needs attention. */
	clearFinished(): void {
		const keepStatuses: DispatchStatus[] = ['running', 'plan-pending', 'plan-ready'];
		for (const [id, record] of this.dispatches) {
			if (keepStatuses.includes(record.status) === false) this.dispatches.delete(id);
		}
		this.notifyListeners();
	}

	/** Writes an audit prompt, runs the selected provider, and returns its record identifier. */
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

	/** Starts review-only plan generation and returns the record awaiting approval. */
	async dispatchPlan(app: App, settings: PluginSettings, context: AIContext, task: Task): Promise<string> {
		if (this.canStartDispatch(settings) === false) return '';
		const planPrompt = composePlanPrompt(context, task);
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

	/** Reuses a plan record while executing its explicitly approved instructions. */
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

	/** Marks a plan awaiting approval as rejected. */
	rejectPlan(planId: string): void {
		const record = this.dispatches.get(planId);
		if (record === undefined || record.status !== 'plan-ready') return;
		record.status = 'plan-rejected';
		record.endTime = Date.now();
		this.notifyListeners();
		new Notice('AI Plan rejected.');
	}

	/** Refreshes model options through the selected provider adapter. */
	async refreshModels(settings: PluginSettings): Promise<AIModelOption[]> {
		return this.providerRunner.refreshModels(settings);
	}

	/** Reports whether the provider adapter can load in this runtime. */
	isProviderAvailable(tool: AITool): boolean {
		return this.providerRunner.isAvailable(tool);
	}

	/** Opens a terminal application at the supplied vault path. */
	openTerminal(vaultPath: string, terminalApp: 'ghostty' | 'terminal'): void {
		this.providerRunner.openTerminal(vaultPath, terminalApp);
	}

	/**
	 * Requests a new interactive task session in the configured terminal.
	 * Successful return means the detached launch was requested; validation failures throw.
	 */
	openInteractiveTaskSession(settings: PluginSettings, workingDirectory: string, prompt: string): void {
		this.providerRunner.openInteractiveTaskSession(settings, workingDirectory, prompt);
	}

	/** Opens a working directory in the selected editor. */
	openIDE(workingDirectory: string, ide: 'cursor' | 'vscode'): void {
		this.providerRunner.openIDE(workingDirectory, ide);
	}

	/** Terminates every local provider process tracked by the runner. */
	killAll(): void {
		this.providerRunner.killAll();
	}

	/** Notifies terminal-state subscribers after a dispatch completes or fails. */
	private notifyFinish(record: DispatchRecord): void {
		for (const listener of this.finishListeners) listener(record);
	}

	/** Notifies collection subscribers after state or membership changes. */
	private notifyListeners(): void {
		for (const listener of this.listeners) listener();
	}

	/** Validates provider availability, concurrency, and executable path safety. */
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

	/** Writes the audit prompt note and resolves provider execution paths. */
	private async writePromptFile(app: App, settings: PluginSettings, prompt: string, task?: Task): Promise<PromptFileInfo> {
		const slug = task ? toPromptSlug(task.title) : '_general';
		const folder = normalizePath(`${settings.outputFolder}/dispatches/${slug}`);
		await ensureVaultFolder(app, folder);
		const promptPath = normalizePath(`${folder}/prompt.md`);
		const existing = app.vault.getAbstractFileByPath(promptPath);
		if (existing instanceof TFile) {
			await app.vault.modify(existing, prompt);
		} else {
			await app.vault.create(promptPath, prompt);
		}

		const vaultPath = (app.vault.adapter as { basePath?: string }).basePath ?? '';
		return {
			vaultPath,
			promptContent: prompt,
			execCwd: task?.workingDirectory || vaultPath,
		};
	}

	/** Runs a provider request and advances its record through success or failure. */
	private async runProviderIntoRecord(
		settings: PluginSettings,
		promptInfo: PromptFileInfo,
		record: DispatchRecord,
		successLabel: string,
		phase: AIDispatchPhase = AI_DISPATCH_PHASE.DISPATCH,
	): Promise<boolean> {
		this.trackDispatchStart();
		try {
			const result = await this.providerRunner.run(settings, promptInfo, phase);
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

	/** Runs review-only plan generation and stores non-empty output for approval. */
	private async runPlanIntoRecord(settings: PluginSettings, promptInfo: PromptFileInfo, record: DispatchRecord): Promise<void> {
		this.trackDispatchStart();
		try {
			const result: ProviderRunResult = await this.providerRunner.run(settings, promptInfo, AI_DISPATCH_PHASE.PLAN);
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

	/** Marks a record failed while retaining only sanitized diagnostic text. */
	private failRecord(record: DispatchRecord, message: string, notice: string, output?: string): void {
		record.status = 'failed';
		record.endTime = Date.now();
		record.error = sanitizeProviderText(message);
		record.output = output === undefined ? undefined : sanitizeProviderText(output);
		this.notifyListeners();
		this.notifyFinish(record);
		new Notice(notice);
	}

	/** Keeps the historical private test seam while delegating argument policy. */
	private buildCliArgs(
		settings: PluginSettings,
		tool: typeof AI_TOOL.CODEX_CLI | typeof AI_TOOL.CLAUDE_CODE,
		phase: AIDispatchPhase,
		promptContent: string,
	): string[] {
		return this.providerRunner.buildCliArgs(settings, tool, phase, promptContent);
	}

	/** Converts provider failures into safe user-facing text. */
	private errorMessage(error: unknown): string {
		return this.providerRunner.errorMessage(error);
	}

	/** Increments the provider concurrency counter before asynchronous work. */
	private trackDispatchStart(): void {
		this.activeDispatchCount++;
	}

	/** Decrements the provider concurrency counter after asynchronous work. */
	private trackDispatchEnd(): void {
		this.activeDispatchCount = Math.max(0, this.activeDispatchCount - 1);
	}
}
