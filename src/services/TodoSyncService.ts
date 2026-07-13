/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vaultboard
 * Description: Synchronizes pending Vault checklists into dashboard tasks through canonical references
 * Created: 2026-07-12
 */

import { App, normalizePath, TFile } from 'obsidian';
import { AI_TASKS_CATEGORY_ID, type LinkedReference, type PluginSettings, type Task } from '../core/types';
import type { TaskManager } from '../core/TaskManager';
import { TaskImporter, type TaskImportItem } from './TaskImporter';

/** Counts produced by one automatic TODO synchronization. */
export interface TodoSyncSummary {
	/** New dashboard tasks created from pending checklist items. */
	added: number;
	/** Existing canonical references matched without creating duplicates. */
	linked: number;
	/** References whose source checklist is no longer pending. */
	retired: number;
}

/** Dependencies that keep persisted reference ownership in the plugin root. */
export interface TodoSyncDependencies {
	/** Returns the current plugin settings. */
	getSettings: () => PluginSettings;
	/** Returns the mutable canonical reference registry. */
	getReferences: () => LinkedReference[];
	/** Persists registry changes. */
	onReferencesChanged: () => void;
}

/** One user-confirmed note import routed through the canonical registry. */
export interface TodoImportRequest {
	/** Task title from the source checklist. */
	title: string;
	/** Nested checklist children. */
	subtasks: TaskImportItem['subtasks'];
	/** Vault-relative source note path. */
	sourcePath: string;
	/** 1-based source line. */
	sourceLine: number;
	/** Zero-based occurrence among identical checklist titles. */
	sourceOccurrence: number;
	/** User-selected task duration. */
	durationMinutes: number;
	/** @deprecated TODO imports always use the immutable AI Tasks category. */
	categoryId: string;
}

const emptySummary = (): TodoSyncSummary => ({ added: 0, linked: 0, retired: 0 });

/** Synchronizes Vault checklist TODOs while keeping one canonical source reference per task. */
export class TodoSyncService {
	private app: App;
	private taskManager: TaskManager;
	private dependencies: TodoSyncDependencies;
	private syncQueue: Promise<void> = Promise.resolve();

	/** Creates the synchronizer around Vault, task, and persisted reference boundaries. */
	constructor(app: App, taskManager: TaskManager, dependencies: TodoSyncDependencies) {
		this.app = app;
		this.taskManager = taskManager;
		this.dependencies = dependencies;
	}

	/** Scans every in-scope Markdown note and retires references for deleted source files. */
	async syncAll(): Promise<TodoSyncSummary> {
		return this.enqueue(() => this.syncAllNow());
	}

	/** Synchronizes one Markdown note and deduplicates by stable text identity before line metadata. */
	async syncFile(file: TFile): Promise<TodoSyncSummary> {
		return this.enqueue(() => this.syncFileNow(file));
	}

	/** Adds one manual note import through the same canonical registry used by automatic sync. */
	async importTodo(request: TodoImportRequest): Promise<Task | undefined> {
		return this.enqueue(async () => this.importTodoNow(request));
	}

	/** Waits for any manual import or source synchronization already in flight. */
	async drain(): Promise<void> {
		await this.syncQueue;
	}

	/** Performs one manual import inside the serialized synchronization boundary. */
	private importTodoNow(request: TodoImportRequest): Task | undefined {
		const sourcePath = normalizePath(request.sourcePath);
		let reference = this.todoReferences().find((candidate) =>
			normalizePath(candidate.sourcePath) === sourcePath
			&& candidate.sourceText === request.title
			&& candidate.sourceOccurrence === request.sourceOccurrence,
		);
		if (reference === undefined) {
			reference = this.todoReferences().find((candidate) =>
				normalizePath(candidate.sourcePath) === sourcePath
				&& candidate.sourceLine === request.sourceLine,
			);
		}
		if (reference !== undefined && this.taskExists(reference.targetId)) {
			if (this.moveLiveTaskToAIIntake(reference.targetId)) this.taskManager.clearUndoHistory();
			return undefined;
		}

		const task = this.createTask(
			request.title,
			request.subtasks,
			request.durationMinutes,
		);
		if (reference === undefined) {
			this.dependencies.getReferences().push({
				id: this.generateReferenceId(),
				kind: 'vault-checklist',
				targetKind: 'task',
				targetId: task.id,
				sourcePath,
				sourceLine: request.sourceLine,
				sourceText: request.title,
				sourceOccurrence: request.sourceOccurrence,
				state: 'active',
			});
		} else {
			reference.targetId = task.id;
			reference.sourcePath = sourcePath;
			reference.sourceLine = request.sourceLine;
			reference.sourceText = request.title;
			reference.sourceOccurrence = request.sourceOccurrence;
			reference.state = 'active';
		}
		this.dependencies.onReferencesChanged();
		this.taskManager.clearUndoHistory();
		return task;
	}

	/** Performs a full scan inside the serialized synchronization boundary. */
	private async syncAllNow(): Promise<TodoSyncSummary> {
		const settings = this.dependencies.getSettings();
		const files = this.app.vault.getMarkdownFiles().filter((file) => this.isInScope(file.path, settings));
		const sourcePaths = new Set(files.map((file) => normalizePath(file.path)));
		const summary = emptySummary();

		for (const file of files) {
			this.mergeSummary(summary, await this.syncFileNow(file));
		}

		let changed = false;
		for (const reference of this.todoReferences()) {
			const inScope = this.isInScope(reference.sourcePath, settings);
			if (inScope && sourcePaths.has(normalizePath(reference.sourcePath))) continue;
			if (reference.state === 'retired') continue;
			reference.state = 'retired';
			summary.retired += 1;
			changed = true;
		}
		if (changed) this.dependencies.onReferencesChanged();
		return summary;
	}

	/** Performs a single-file scan inside the serialized synchronization boundary. */
	private async syncFileNow(file: TFile): Promise<TodoSyncSummary> {
		const settings = this.dependencies.getSettings();
		if (file.extension !== 'md' || this.isInScope(file.path, settings) === false) return emptySummary();

		const sourcePath = normalizePath(file.path);
		const references = this.todoReferences().filter((reference) => normalizePath(reference.sourcePath) === sourcePath);
		const matchedReferenceIds = new Set<string>();
		const pendingItems = (await TaskImporter.scanNote(this.app, file))
			.filter((item) => item.status === 'pending');
		const itemReferences = new Map<TaskImportItem, LinkedReference>();
		const availableReferenceIds = new Set(references.map((reference) => reference.id));
		const matchItems = (
			state: LinkedReference['state'],
			matches: (candidate: LinkedReference, item: TaskImportItem) => boolean,
			requireUnique = false,
		): void => {
			for (const item of pendingItems) {
				if (itemReferences.has(item)) continue;
				const candidates = references.filter((candidate) =>
					availableReferenceIds.has(candidate.id)
					&& candidate.state === state
					&& matches(candidate, item),
				);
				if (candidates.length === 0 || (requireUnique && candidates.length !== 1)) continue;
				itemReferences.set(item, candidates[0]);
				availableReferenceIds.delete(candidates[0].id);
			}
		};

		// Preserve the active duplicate before considering a retired twin whose old occurrence now collides.
		matchItems('active', (candidate, item) =>
			candidate.sourceText === item.title
			&& candidate.sourceOccurrence === item.occurrence);
		matchItems('active', (candidate, item) => candidate.sourceText === item.title, true);
		matchItems('retired', (candidate, item) =>
			candidate.sourceText === item.title
			&& candidate.sourceOccurrence === item.occurrence);
		matchItems('retired', (candidate, item) => candidate.sourceText === item.title, true);
		matchItems('active', (candidate, item) => candidate.sourceLine === item.line);
		matchItems('retired', (candidate, item) => candidate.sourceLine === item.line);
		const summary = emptySummary();
		let changed = false;
		let taskStateChanged = false;

		for (const item of pendingItems) {
			let reference = itemReferences.get(item);

			if (reference === undefined) {
				const task = this.createTask(
					item.title,
					item.subtasks,
					settings.todoDefaultDurationMinutes,
				);
				reference = {
					id: this.generateReferenceId(),
					kind: 'vault-checklist',
					targetKind: 'task',
					targetId: task.id,
					sourcePath,
					sourceLine: item.line,
					sourceText: item.title,
					sourceOccurrence: item.occurrence,
					state: 'active',
				};
				this.dependencies.getReferences().push(reference);
				references.push(reference);
				summary.added += 1;
				changed = true;
				taskStateChanged = true;
			} else {
				if (this.taskExists(reference.targetId) === false) {
					reference.targetId = this.createTask(
						item.title,
						item.subtasks,
						settings.todoDefaultDurationMinutes,
					).id;
					summary.added += 1;
					changed = true;
					taskStateChanged = true;
				} else {
					const activeTask = this.taskManager.getTask(reference.targetId);
					if (this.moveLiveTaskToAIIntake(reference.targetId)) taskStateChanged = true;
					if (
						activeTask !== undefined
						&& reference.sourceText !== item.title
						&& activeTask.title === reference.sourceText
					) {
						this.taskManager.updateTask(activeTask.id, { title: item.title });
						taskStateChanged = true;
					}
					summary.linked += 1;
				}
				if (
					reference.sourceLine !== item.line
					|| reference.sourceText !== item.title
					|| reference.sourceOccurrence !== item.occurrence
					|| reference.state !== 'active'
				) {
					reference.sourceLine = item.line;
					reference.sourceText = item.title;
					reference.sourceOccurrence = item.occurrence;
					reference.state = 'active';
					changed = true;
				}
			}
			matchedReferenceIds.add(reference.id);
		}

		for (const reference of references) {
			if (matchedReferenceIds.has(reference.id) || reference.state === 'retired') continue;
			reference.state = 'retired';
			summary.retired += 1;
			changed = true;
		}

		if (changed) this.dependencies.onReferencesChanged();
		if (taskStateChanged) this.taskManager.clearUndoHistory();
		return summary;
	}

	/** Moves canonical source paths after an Obsidian note rename. */
	async renameSource(oldPath: string, newPath: string): Promise<void> {
		return this.enqueue(async () => this.renameSourceNow(oldPath, newPath));
	}

	/** Performs a source rename inside the serialized synchronization boundary. */
	private renameSourceNow(oldPath: string, newPath: string): void {
		const normalizedOldPath = normalizePath(oldPath);
		const normalizedNewPath = normalizePath(newPath);
		let changed = false;
		for (const reference of this.todoReferences()) {
			const sourcePath = normalizePath(reference.sourcePath);
			if (sourcePath !== normalizedOldPath && sourcePath.startsWith(`${normalizedOldPath}/`) === false) continue;
			reference.sourcePath = `${normalizedNewPath}${sourcePath.slice(normalizedOldPath.length)}`;
			if (
				reference.sourcePath.toLowerCase().endsWith('.md') === false
				|| this.isInScope(reference.sourcePath, this.dependencies.getSettings()) === false
			) reference.state = 'retired';
			changed = true;
		}
		if (changed) this.dependencies.onReferencesChanged();
	}

	/** Retires references when their source note is deleted. */
	async retireSource(path: string): Promise<number> {
		return this.enqueue(async () => this.retireSourceNow(path));
	}

	/** Performs source retirement inside the serialized synchronization boundary. */
	private retireSourceNow(path: string): number {
		const normalizedPath = normalizePath(path);
		let retired = 0;
		for (const reference of this.todoReferences()) {
			const sourcePath = normalizePath(reference.sourcePath);
			const matchesSource = sourcePath === normalizedPath || sourcePath.startsWith(`${normalizedPath}/`);
			if (matchesSource === false || reference.state === 'retired') continue;
			reference.state = 'retired';
			retired += 1;
		}
		if (retired > 0) this.dependencies.onReferencesChanged();
		return retired;
	}

	/** Creates the dashboard task linked by a new or repaired canonical reference. */
	private createTask(title: string, subtasks: TaskImportItem['subtasks'], durationMinutes: number): Task {
		const task = this.taskManager.addTask(title, durationMinutes, ['todo']);
		if (subtasks.length > 0) this.taskManager.replaceSubtasks(task.id, subtasks);
		this.taskManager.assignTaskCategory(task.id, AI_TASKS_CATEGORY_ID);
		return task;
	}

	/** Repairs live canonical targets that predate the immutable AI Tasks intake category. */
	private moveLiveTaskToAIIntake(taskId: string): boolean {
		const task = this.taskManager.getTask(taskId);
		if (task !== undefined && task.categoryId !== AI_TASKS_CATEGORY_ID) {
			this.taskManager.assignTaskCategory(task.id, AI_TASKS_CATEGORY_ID);
			return true;
		}
		return false;
	}

	/** Reports whether a canonical target still exists in active or archived tasks. */
	private taskExists(taskId: string): boolean {
		return this.taskManager.getTask(taskId) !== undefined
			|| this.taskManager.getArchivedTasks().some((task) => task.id === taskId);
	}

	/** Returns checklist references from the shared extensible registry. */
	private todoReferences(): LinkedReference[] {
		return this.dependencies.getReferences().filter((reference) => reference.kind === 'vault-checklist');
	}

	/** Applies the configured Vault-relative folder boundary. */
	private isInScope(path: string, settings: PluginSettings): boolean {
		const sourceFolder = normalizePath(settings.todoSourceFolder.trim()).replace(/^\/+|\/+$/g, '');
		if (sourceFolder === '') return true;
		const normalizedPath = normalizePath(path);
		return normalizedPath.startsWith(`${sourceFolder}/`);
	}

	/** Adds one file result into an aggregate synchronization result. */
	private mergeSummary(target: TodoSyncSummary, source: TodoSyncSummary): void {
		target.added += source.added;
		target.linked += source.linked;
		target.retired += source.retired;
	}

	/** Serializes scans, imports, and source lifecycle mutations so references cannot race. */
	private enqueue<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.syncQueue.then(operation, operation);
		this.syncQueue = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	}

	/** Generates a stable-enough registry identifier without external dependencies. */
	private generateReferenceId(): string {
		return `ref_${Date.now().toString(36)}${Math.random().toString(36).substring(2, 8)}`;
	}
}
