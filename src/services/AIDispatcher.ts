/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard Welcome
 * Description: AI context assembler and terminal dispatcher for Cursor/Claude Code CLI
 * Created: 2026-03-08
 * Last Modified: 2026-03-09
 */

import { App, TFile, normalizePath, Notice } from 'obsidian';
import { Task, PluginSettings, DispatchHistoryEntry, DispatchStatus } from '../core/types';
import { TaskManager } from '../core/TaskManager';

/** Actions the AI dispatcher can perform on task context. */
export type AIAction =
	| 'organize'
	| 'order'
	| 'create-doc'
	| 'schedule'
	| 'delegate';

/** Assembled context passed to the AI prompt composer. */
interface AIContext {
	tasks: Task[];
	archivedTasks: Task[];
	linkedDocContents: Map<string, string>;
	imagePaths: string[];
}

/** Human-readable labels for each AI action. */
const ACTION_LABELS: Record<AIAction, string> = {
	organize: 'AI Organize',
	order: 'AI Auto-Order',
	'create-doc': 'AI Create Doc',
	schedule: 'AI Auto-Schedule',
	delegate: 'AI Delegate',
};

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

type DispatchListener = () => void;
type DispatchFinishListener = (record: DispatchRecord) => void;

const ACTION_INSTRUCTIONS: Record<AIAction, string> = {
	organize: 'Analyze this task and suggest appropriate tags and timeline position relative to the other tasks. Return a JSON object with { tags: string[], insertAfterTaskId: string | null }.',
	order: 'Reorder these pending tasks by priority, dependency, and logical flow. Return a JSON array of task IDs in the optimal order.',
	'create-doc': 'Create a comprehensive document for this task based on the provided context. Output the document content in markdown format.',
	schedule: 'Estimate durations for tasks that lack them and optimize existing durations based on task complexity. Return a JSON array of { taskId: string, durationMinutes: number }.',
	delegate: 'Execute the following task. The description below is your primary instruction.',
};

const PLAN_PHASE_INSTRUCTION = 'Analyze this task and produce a detailed step-by-step execution plan. Describe exactly what you will do, which files you will touch, and the expected outcome. Do NOT execute anything yet -- only output the plan.';

const EXECUTE_PHASE_PREFIX = 'The user has reviewed and approved the following execution plan. Proceed to execute it exactly as described.\n\n## Approved Plan\n';

/** Sanitizes a string into a filesystem-safe slug. */
const toSlug = (s: string): string =>
	s.substring(0, 60).replace(/[\\/:*?"<>|#^[\]]/g, '-').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'untitled';

/** Creates nested vault folders if they don't exist. */
const ensureFolder = async (app: App, folderPath: string): Promise<void> => {
	const parts = folderPath.split('/').filter(Boolean);
	let current = '';
	for (const part of parts) {
		current = current ? `${current}/${part}` : part;
		if (app.vault.getAbstractFileByPath(current) === null) {
			await app.vault.createFolder(current);
		}
	}
};

/**
 * Assembles task context into a structured prompt and dispatches it
 * to an external AI CLI tool (Cursor or Claude Code).
 */
export class AIDispatcher {

	private static dispatches = new Map<string, DispatchRecord>();
	private static listeners: DispatchListener[] = [];
	private static finishListeners: DispatchFinishListener[] = [];
	private static nextId = 1;

	/**
	 * Loads persisted dispatch entries back into the in-memory map.
	 * Running entries that weren't completed are marked as failed since
	 * the process is gone after a restart.
	 */
	static hydrate(entries: DispatchHistoryEntry[]): void {
		for (const entry of entries) {
			const rec: DispatchRecord = {
				...entry,
				action: entry.action as AIAction,
				output: undefined,
			};
			if (rec.status === 'running' || rec.status === 'plan-pending') {
				rec.status = 'failed';
				rec.endTime = rec.endTime ?? Date.now();
				rec.error = 'Process lost on reload';
			}
			this.dispatches.set(rec.id, rec);
			const num = parseInt(rec.id, 10);
			if (Number.isNaN(num) === false && num >= this.nextId) {
				this.nextId = num + 1;
			}
		}
		this.notifyListeners();
	}

	/** Serializes current dispatch records for disk persistence. */
	static toJSON(): DispatchHistoryEntry[] {
		return [...this.dispatches.values()].map((rec) => ({
			id: rec.id,
			action: rec.action,
			label: rec.label,
			taskId: rec.taskId,
			taskTitle: rec.taskTitle,
			tool: rec.tool,
			status: rec.status,
			startTime: rec.startTime,
			endTime: rec.endTime,
			error: rec.error,
			vaultPath: rec.vaultPath,
			planText: rec.planText,
			parentPlanId: rec.parentPlanId,
		}));
	}

	/** Clears all dispatch records regardless of status. */
	static clearAll(): void {
		this.dispatches.clear();
		this.notifyListeners();
	}

	/** Subscribe to dispatch list changes. Returns an unsubscribe function. */
	static onDispatchChange(fn: DispatchListener): () => void {
		this.listeners.push(fn);
		return () => { this.listeners = this.listeners.filter((l) => l !== fn); };
	}

	/** Subscribe to dispatch finish events (completed or failed). Returns an unsubscribe function. */
	static onDispatchFinish(fn: DispatchFinishListener): () => void {
		this.finishListeners.push(fn);
		return () => { this.finishListeners = this.finishListeners.filter((l) => l !== fn); };
	}

	private static notifyFinish(record: DispatchRecord): void {
		for (const fn of this.finishListeners) fn(record);
	}

	private static notifyListeners(): void {
		for (const fn of this.listeners) fn();
	}

	/** Returns all dispatch records, newest first. */
	static getDispatches(): DispatchRecord[] {
		return [...this.dispatches.values()].sort((a, b) => b.startTime - a.startTime);
	}

	/** Clears completed/failed records from the list. */
	static clearFinished(): void {
		const keepStatuses: DispatchStatus[] = ['running', 'plan-pending', 'plan-ready'];
		for (const [id, rec] of this.dispatches) {
			if (keepStatuses.includes(rec.status) === false) this.dispatches.delete(id);
		}
		this.notifyListeners();
	}

	/**
	 * Returns true if an AI tool is configured in settings.
	 * @param settings - Plugin settings to check
	 */
	static isEnabled(settings: PluginSettings): boolean {
		return settings.aiTool !== 'none';
	}

	/**
	 * Reads all tasks, linked documents, and image paths into a single context object.
	 * @param taskManager - Source for active and archived tasks
	 * @param app - Obsidian app instance for vault file reads
	 * @returns Assembled AI context
	 */
	static async gatherContext(taskManager: TaskManager, app: App): Promise<AIContext> {
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
	}

	/**
	 * Composes a markdown prompt from an action, context, and optional focus task.
	 * @param action - The AI action to perform
	 * @param context - Assembled task and document context
	 * @param focusTask - Optional task to highlight in the prompt
	 * @returns Formatted markdown prompt string
	 */
	static composePrompt(action: AIAction, context: AIContext, focusTask?: Task): string {
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
	}

	/**
	 * Composes a plan-phase prompt that reuses the standard context layout
	 * but swaps in the plan-generation instruction instead of the delegate one.
	 */
	private static composePlanPrompt(context: AIContext, focusTask: Task): string {
		const saved = ACTION_INSTRUCTIONS['delegate'];
		ACTION_INSTRUCTIONS['delegate'] = PLAN_PHASE_INSTRUCTION;
		const prompt = this.composePrompt('delegate', context, focusTask);
		ACTION_INSTRUCTIONS['delegate'] = saved;
		return prompt;
	}

	/**
	 * Writes the prompt to a temp vault file and executes the configured AI CLI tool.
	 * Tracks the running process so the DispatchModule can display it.
	 * @param app - Obsidian app instance
	 * @param settings - Plugin settings with AI tool config
	 * @param action - The AI action being performed
	 * @param prompt - Composed prompt string to send
	 * @param task - Optional task for context labeling in the dispatch list
	 */
	static async dispatch(app: App, settings: PluginSettings, action: AIAction, prompt: string, task?: Task): Promise<void> {
		if (settings.aiTool === 'none') {
			new Notice('No AI tool configured. Set one in Settings > AI.');
			return;
		}

		const slug = task ? toSlug(task.title) : '_general';
		const folder = normalizePath(`${settings.outputFolder}/dispatches/${slug}`);
		await ensureFolder(app, folder);
		const tempPath = normalizePath(`${folder}/prompt.md`);
		const existing = app.vault.getAbstractFileByPath(tempPath);
		if (existing instanceof TFile) {
			await app.vault.modify(existing, prompt);
		} else {
			await app.vault.create(tempPath, prompt);
		}

		const vaultPath = (app.vault.adapter as { basePath?: string }).basePath ?? '';
		const promptFile = `${vaultPath}/${tempPath}`;

		const toolPath = settings.aiToolPath || await this.resolveToolPath(settings.aiTool);
		const subcommand = settings.aiTool === 'cursor' ? 'agent' : '--print';
		const skipFlag = this.permissionsFlag(settings);
		const innerCmd = `${toolPath} ${subcommand}${skipFlag} "$(cat '${promptFile}')"`;

		const userShell = process.env.SHELL || '/bin/zsh';
		const command = `${userShell} -lc ${this.shellQuote(innerCmd)}`;
		const execCwd = this.resolveWorkingDirectory(vaultPath, settings);

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
			vaultPath,
		};
		this.dispatches.set(recordId, record);
		this.notifyListeners();

		new Notice(`${actionLabel}: running ${settings.aiTool}...`);

		const { exec } = require('child_process') as typeof import('child_process');
		return new Promise<void>((resolve, reject) => {
			const child = exec(command, { cwd: execCwd, maxBuffer: 1024 * 1024 * 5 }, (error: Error | null, stdout: string, _stderr: string) => {
				if (error) {
					record.status = 'failed';
					record.endTime = Date.now();
					record.error = error.message;
					record.output = stdout || undefined;
					this.notifyListeners();
					this.notifyFinish(record);
					new Notice(`${actionLabel} error: ${error.message}`);
					console.error('[AIDispatcher]', error);
					reject(error);
					return;
				}
			record.status = 'completed';
				record.endTime = Date.now();
				record.output = stdout || undefined;
				this.notifyListeners();
				this.notifyFinish(record);
				new Notice(`${actionLabel} complete.`);
				resolve();
			});
			record.pid = child.pid;
			this.notifyListeners();
		});
	}

	/**
	 * Phase 1 of the delegate flow: dispatches a plan-generation prompt that
	 * asks the AI to describe what it will do without executing. The returned
	 * record ID can be watched via `onDispatchChange` until `status` flips to
	 * `'plan-ready'` (stdout captured in `planText`).
	 *
	 * Always uses `--print` / non-interactive mode so stdout is captured.
	 */
	static async dispatchPlan(app: App, settings: PluginSettings, context: AIContext, task: Task): Promise<string> {
		if (settings.aiTool === 'none') {
			new Notice('No AI tool configured. Set one in Settings > AI.');
			return '';
		}

		const planPrompt = this.composePlanPrompt(context, task);

		const slug = toSlug(task.title);
		const folder = normalizePath(`${settings.outputFolder}/dispatches/${slug}`);
		await ensureFolder(app, folder);
		const tempPath = normalizePath(`${folder}/prompt.md`);
		const existing = app.vault.getAbstractFileByPath(tempPath);
		if (existing instanceof TFile) {
			await app.vault.modify(existing, planPrompt);
		} else {
			await app.vault.create(tempPath, planPrompt);
		}

		const vaultPath = (app.vault.adapter as { basePath?: string }).basePath ?? '';
		const promptFile = `${vaultPath}/${tempPath}`;

		const toolPath = settings.aiToolPath || await this.resolveToolPath(settings.aiTool);
		const subcommand = settings.aiTool === 'cursor' ? 'agent' : '--print';
		const skipFlag = this.permissionsFlag(settings);
		const innerCmd = `${toolPath} ${subcommand}${skipFlag} "$(cat '${promptFile}')"`;

		const userShell = process.env.SHELL || '/bin/zsh';
		const command = `${userShell} -lc ${this.shellQuote(innerCmd)}`;
		const execCwd = this.resolveWorkingDirectory(vaultPath, settings);

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
			vaultPath,
		};
		this.dispatches.set(recordId, record);
		this.notifyListeners();

		new Notice(`AI Plan: generating plan via ${settings.aiTool}...`);

		const { exec } = require('child_process') as typeof import('child_process');
		exec(command, { cwd: execCwd, maxBuffer: 1024 * 1024 * 5 }, (error: Error | null, stdout: string, stderr: string) => {
			if (error) {
				record.status = 'failed';
				record.endTime = Date.now();
				record.error = error.message;
				record.output = stdout || undefined;
				this.notifyListeners();
				this.notifyFinish(record);
				new Notice(`AI Plan error: ${error.message}`);
				console.error('[AIDispatcher] plan phase error', error);
				return;
			}
			const trimmedOutput = (stdout || '').trim();
			if (trimmedOutput.length === 0) {
				record.status = 'failed';
				record.endTime = Date.now();
				record.error = 'AI returned empty plan (no stdout). Check that the CLI tool is installed and accessible.';
				record.output = stderr || undefined;
				this.notifyListeners();
				this.notifyFinish(record);
				new Notice('AI Plan failed: no output received.');
				console.error('[AIDispatcher] plan phase returned empty stdout. stderr:', stderr);
				return;
			}

			record.status = 'plan-ready';
			record.endTime = Date.now();
			record.planText = trimmedOutput;
			record.output = stdout || undefined;
			this.notifyListeners();
			new Notice('AI Plan ready -- review and approve.');
		});

		return recordId;
	}

	/**
	 * Phase 2: dispatches the approved plan for execution. Uses the
	 * configured subcommand (interactive for Cursor, `--print` for Claude).
	 */
	static async dispatchExecute(app: App, settings: PluginSettings, planId: string): Promise<void> {
		const planRecord = this.dispatches.get(planId);
		if (planRecord === undefined || planRecord.status !== 'plan-ready' || planRecord.planText === undefined) {
			new Notice('No approved plan found.');
			return;
		}

		planRecord.status = 'plan-approved';
		this.notifyListeners();

		const executePrompt = EXECUTE_PHASE_PREFIX + planRecord.planText;

		const slug = toSlug(planRecord.taskTitle);
		const folder = normalizePath(`${settings.outputFolder}/dispatches/${slug}`);
		await ensureFolder(app, folder);
		const tempPath = normalizePath(`${folder}/prompt.md`);
		const existing = app.vault.getAbstractFileByPath(tempPath);
		if (existing instanceof TFile) {
			await app.vault.modify(existing, executePrompt);
		} else {
			await app.vault.create(tempPath, executePrompt);
		}

		const vaultPath = (app.vault.adapter as { basePath?: string }).basePath ?? '';
		const promptFile = `${vaultPath}/${tempPath}`;

		const toolPath = settings.aiToolPath || await this.resolveToolPath(settings.aiTool);
		const subcommand = settings.aiTool === 'cursor' ? 'agent' : '--print';
		const skipFlag = this.permissionsFlag(settings);
		const innerCmd = `${toolPath} ${subcommand}${skipFlag} "$(cat '${promptFile}')"`;

		const userShell = process.env.SHELL || '/bin/zsh';
		const command = `${userShell} -lc ${this.shellQuote(innerCmd)}`;
		const execCwd = this.resolveWorkingDirectory(vaultPath, settings);

		const recordId = String(this.nextId++);
		const record: DispatchRecord = {
			id: recordId,
			action: 'delegate',
			label: `AI Execute: ${planRecord.taskTitle}`,
			taskId: planRecord.taskId,
			taskTitle: planRecord.taskTitle,
			tool: settings.aiTool,
			status: 'running',
			startTime: Date.now(),
			vaultPath,
			parentPlanId: planId,
			planText: planRecord.planText,
		};
		this.dispatches.set(recordId, record);
		this.notifyListeners();

		new Notice(`AI Execute: running ${settings.aiTool}...`);

		const { exec } = require('child_process') as typeof import('child_process');
		return new Promise<void>((resolve, reject) => {
			const child = exec(command, { cwd: execCwd, maxBuffer: 1024 * 1024 * 5 }, (error: Error | null, stdout: string, _stderr: string) => {
				if (error) {
					record.status = 'failed';
					record.endTime = Date.now();
					record.error = error.message;
					record.output = stdout || undefined;
					this.notifyListeners();
					this.notifyFinish(record);
					new Notice(`AI Execute error: ${error.message}`);
					console.error('[AIDispatcher] execute phase error', error);
					reject(error);
					return;
				}
				record.status = 'completed';
				record.endTime = Date.now();
				record.output = stdout || undefined;
				this.notifyListeners();
				this.notifyFinish(record);
				new Notice('AI Execute complete.');
				resolve();
			});
			record.pid = child.pid;
			this.notifyListeners();
		});
	}

	/** Marks a plan-ready record as rejected. */
	static rejectPlan(planId: string): void {
		const rec = this.dispatches.get(planId);
		if (rec === undefined || rec.status !== 'plan-ready') return;
		rec.status = 'plan-rejected';
		rec.endTime = Date.now();
		this.notifyListeners();
		new Notice('AI Plan rejected.');
	}

	/** Returns a specific dispatch record by ID. */
	static getRecord(id: string): DispatchRecord | undefined {
		return this.dispatches.get(id);
	}

	/**
	 * Focuses the user's preferred terminal app, bringing an existing window
	 * to front. Falls back to launching the app at vaultPath if not running.
	 * @param vaultPath - Fallback directory when launching fresh
	 * @param terminalApp - Terminal application preference
	 */
	static openTerminal(vaultPath: string, terminalApp: 'ghostty' | 'terminal'): void {
		const { exec } = require('child_process') as typeof import('child_process');
		const appName = terminalApp === 'ghostty' ? 'Ghostty' : 'Terminal';
		exec(
			`osascript -e 'if application "${appName}" is running then' -e 'tell application "${appName}" to activate' -e 'else' -e 'do shell script "open -a ${appName} \\"${vaultPath}\\""' -e 'end if'`,
		);
	}

	/**
	 * Resolves the full path of a CLI tool via the user's login shell.
	 * GUI apps like Obsidian don't inherit the terminal PATH, so a bare
	 * command name will fail. Falls back to the tool name if resolution fails.
	 */
	private static resolveToolPath(tool: string): Promise<string> {
		const { execSync } = require('child_process') as typeof import('child_process');
		const userShell = process.env.SHELL || '/bin/zsh';
		try {
			const resolved = execSync(`${userShell} -lic "which ${tool}"`, {
				timeout: 5000,
				encoding: 'utf-8',
			}).trim();
			return Promise.resolve(resolved || tool);
		} catch {
			return Promise.resolve(tool);
		}
	}

	/** Resolves the effective working directory from settings, falling back to vault root. */
	private static resolveWorkingDirectory(vaultPath: string, settings: PluginSettings): string {
		return settings.aiWorkingDirectory || vaultPath;
	}

	/** Returns the skip-permissions flag appropriate for the configured AI tool, or empty string. */
	private static permissionsFlag(settings: PluginSettings): string {
		if (settings.aiSkipPermissions === false) return '';
		if (settings.aiTool === 'claude-code') return ' --dangerously-skip-permissions';
		if (settings.aiTool === 'cursor') return ' --yes';
		return '';
	}

	private static shellQuote(s: string): string {
		return "'" + s.replace(/'/g, "'\\''") + "'";
	}
}
