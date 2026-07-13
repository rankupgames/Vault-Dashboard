import type { App } from 'obsidian';
import type {
	AIModelOption,
	AITool,
	DispatchHistoryEntry,
	PluginSettings,
	Task,
} from '../../core/types';
import type { AIAction } from './AIAction';
import type { AIContext } from './AIContext';
import type { DispatchRecord } from './DispatchRecord';

/** Public contract for the stateful AI dispatch lifecycle. */
export interface IAIDispatcher {
	/** Restores dispatch records from persisted history entries. */
	hydrate(entries: DispatchHistoryEntry[]): void;
	/** Serializes active dispatch records for persistence. */
	toJSON(): DispatchHistoryEntry[];
	/** Clears all dispatch records regardless of status. */
	clearAll(): void;
	/** Removes a single dispatch record by identifier. */
	removeRecord(id: string): void;
	/** Subscribes to dispatch list changes and returns an unsubscribe function. */
	onDispatchChange(listener: () => void): () => void;
	/** Subscribes to terminal dispatch events and returns an unsubscribe function. */
	onDispatchFinish(listener: (record: DispatchRecord) => void): () => void;
	/** Returns all dispatch records in newest-first order. */
	getDispatches(): DispatchRecord[];
	/** Returns a dispatch record by identifier when present. */
	getRecord(id: string): DispatchRecord | undefined;
	/** Removes records that no longer require user attention. */
	clearFinished(): void;
	/** Dispatches an AI action and returns its record identifier on success. */
	dispatch(app: App, settings: PluginSettings, action: AIAction, prompt: string, task?: Task): Promise<string>;
	/** Starts review-only plan generation and returns its record identifier. */
	dispatchPlan(app: App, settings: PluginSettings, context: AIContext, task: Task): Promise<string>;
	/** Executes a previously approved plan. */
	dispatchExecute(app: App, settings: PluginSettings, planId: string, task?: Task): Promise<void>;
	/** Refreshes model options for providers that expose a catalog. */
	refreshModels(settings: PluginSettings): Promise<AIModelOption[]>;
	/** Reports whether an optional provider can load in the current runtime. */
	isProviderAvailable(tool: AITool): boolean;
	/** Marks a plan awaiting approval as rejected. */
	rejectPlan(planId: string): void;
	/** Opens the configured terminal application at a vault path. */
	openTerminal(vaultPath: string, terminalApp: 'ghostty' | 'terminal'): void;
	/**
	 * Requests a new interactive task session using the configured provider and terminal.
	 * A successful return means launch was requested; synchronous validation failures throw.
	 */
	openInteractiveTaskSession(settings: PluginSettings, workingDirectory: string, prompt: string): void;
	/** Opens a directory in the configured editor. */
	openIDE(workingDirectory: string, ide: 'cursor' | 'vscode'): void;
	/** Terminates every tracked local provider process. */
	killAll(): void;
}
