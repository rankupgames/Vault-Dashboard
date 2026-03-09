/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard Welcome
 * Description: Task CRUD operations, subtask management, ordering, and state transitions
 * Created: 2026-03-07
 * Last Modified: 2026-03-07
 */

import { Task, SubTask, TaskTemplate, PluginSettings, DispatchHistoryEntry } from './types';
import { UndoManager } from './UndoManager';
import { EventBus } from './EventBus';
import { TaskEvents } from './events';

interface TaskUndoSnapshot {
	tasks: Task[];
	archivedTasks: Task[];
}

const MAX_SUBTASK_DEPTH = 4;

/** Task CRUD operations, subtask management, ordering, and state transitions. */
export class TaskManager {
	private tasks: Task[];
	private archivedTasks: Task[];
	private settings: PluginSettings;
	private onChangeCallback: (() => void) | null = null;
	private undoManager: UndoManager<TaskUndoSnapshot>;
	private bus: EventBus;

	constructor(tasks: Task[], archivedTasks: Task[] = [], settings: PluginSettings, bus?: EventBus) {
		this.tasks = tasks;
		this.archivedTasks = archivedTasks;
		this.settings = settings;
		this.undoManager = new UndoManager<TaskUndoSnapshot>();
		this.bus = bus ?? new EventBus();
	}

	/** Returns the undo manager for task snapshots. */
	getUndoManager(): UndoManager<TaskUndoSnapshot> {
		return this.undoManager;
	}

	/** Registers a callback invoked when tasks change. */
	onChange(cb: () => void): void {
		this.onChangeCallback = cb;
	}

	/** Returns tasks sorted by order. */
	getTasks(): Task[] {
		return [...this.tasks].sort((a, b) => a.order - b.order);
	}

	/** Returns a task by ID, or undefined. */
	getTask(id: string): Task | undefined {
		return this.tasks.find((t) => t.id === id);
	}

	getActiveTasks(): Task[] {
		return this.getTasks().filter((t) => t.status === 'active');
	}

	/** Returns tasks with status 'pending'. */
	getPendingTasks(): Task[] {
		return this.getTasks().filter((t) => t.status === 'pending');
	}

	getNextPendingTask(): Task | undefined {
		return this.getPendingTasks()[0];
	}

	/** Reverts to the previous snapshot. Returns true if undo was applied. */
	undo(): boolean {
		const snapshot = this.undoManager.undo({ tasks: this.toJSON(), archivedTasks: [...this.archivedTasks] });
		if (snapshot === undefined) return false;
		this.tasks = snapshot.tasks;
		this.archivedTasks = snapshot.archivedTasks;
		this.emitChange();
		return true;
	}

	/** Re-applies the next snapshot. Returns true if redo was applied. */
	redo(): boolean {
		const snapshot = this.undoManager.redo({ tasks: this.toJSON(), archivedTasks: [...this.archivedTasks] });
		if (snapshot === undefined) return false;
		this.tasks = snapshot.tasks;
		this.archivedTasks = snapshot.archivedTasks;
		this.emitChange();
		return true;
	}

	/** Pushes current state onto the undo stack without modifying tasks. */
	saveUndoSnapshot(): void {
		this.pushUndo();
	}

	private pushUndo(): void {
		this.undoManager.push({ tasks: this.toJSON(), archivedTasks: [...this.archivedTasks] });
	}

	addTask(title: string, durationMinutes: number, tags?: string[]): Task {
		this.pushUndo();
		const maxOrder = this.tasks.reduce((max, t) => Math.max(max, t.order), -1);
		const task: Task = {
			id: this.generateId(),
			title,
			durationMinutes,
			status: 'pending',
			order: maxOrder + 1,
			createdAt: Date.now(),
			tags: tags && tags.length > 0 ? tags : undefined,
		};
		this.tasks.push(task);
		this.emitChange();
		return task;
	}

	/** Updates a task's editable fields. */
	updateTask(id: string, updates: Partial<Pick<Task, 'title' | 'description' | 'durationMinutes' | 'tags' | 'linkedDocs' | 'images' | 'delegationStatus' | 'delegationFeedback' | 'dispatchRecords'>>): void {
		const task = this.getTask(id);
		if (task === undefined) return;
		this.pushUndo();
		Object.assign(task, updates);
		this.emitChange();
	}

	/** Attaches a dispatch record to a task. Skips duplicates by record id. */
	attachDispatchRecord(taskId: string, record: DispatchHistoryEntry): void {
		const task = this.getTask(taskId);
		if (task === undefined) return;
		if (task.dispatchRecords === undefined) task.dispatchRecords = [];
		if (task.dispatchRecords.some((r) => r.id === record.id)) return;
		task.dispatchRecords.push(record);
		this.emitChange();
	}

	/** Attaches multiple dispatch records to a task. Skips duplicates. */
	attachDispatchRecords(taskId: string, records: DispatchHistoryEntry[]): void {
		const task = this.getTask(taskId);
		if (task === undefined) return;
		if (task.dispatchRecords === undefined) task.dispatchRecords = [];
		let added = false;
		for (const rec of records) {
			if (task.dispatchRecords.some((r) => r.id === rec.id)) continue;
			task.dispatchRecords.push(rec);
			added = true;
		}
		if (added) this.emitChange();
	}

	/** Adds a linked document path to a task. */
	addLinkedDoc(taskId: string, path: string): void {
		const task = this.getTask(taskId);
		if (task === undefined) return;
		if (task.linkedDocs === undefined) task.linkedDocs = [];
		if (task.linkedDocs.includes(path)) return;
		this.pushUndo();
		task.linkedDocs.push(path);
		this.emitChange();
	}

	/** Removes a linked document path from a task. */
	removeLinkedDoc(taskId: string, path: string): void {
		const task = this.getTask(taskId);
		if (task === undefined || task.linkedDocs === undefined) return;
		this.pushUndo();
		task.linkedDocs = task.linkedDocs.filter((p) => p !== path);
		if (task.linkedDocs.length === 0) task.linkedDocs = undefined;
		this.emitChange();
	}

	/** Removes a task by ID. */
	removeTask(id: string): void {
		const idx = this.tasks.findIndex((t) => t.id === id);
		if (idx === -1) return;
		this.pushUndo();
		this.tasks.splice(idx, 1);
		this.emitChange();
	}

	/** Marks a task as active and records rollover applied. */
	startTask(id: string, rolloverApplied: number): void {
		const task = this.getTask(id);
		if (task === undefined || task.status !== 'pending') return;
		task.status = 'active';
		task.startedAt = Date.now();
		task.rolloverApplied = rolloverApplied;
		this.emitChange();
	}

	/** Marks a task as completed and computes actual duration. */
	completeTask(id: string, actualEndTime?: number): void {
		const task = this.getTask(id);
		if (task === undefined) return;
		this.pushUndo();
		task.status = 'completed';
		task.completedAt = Date.now();
		if (actualEndTime !== undefined) {
			task.actualEndTime = actualEndTime;
		}
		if (task.startedAt) {
			const endMs = task.actualEndTime ?? task.completedAt;
			task.actualDurationMinutes = Math.round((endMs - task.startedAt) / 60000);
		}
		this.completeAllSubtasks(task.subtasks);
		this.emitChange();
	}

	/** Reverts a completed or skipped task to pending. */
	uncompleteTask(id: string): void {
		const task = this.getTask(id);
		if (task === undefined) return;
		if (task.status !== 'completed' && task.status !== 'skipped') return;
		this.pushUndo();
		task.status = 'pending';
		task.completedAt = undefined;
		task.actualEndTime = undefined;
		task.startedAt = undefined;
		task.rolloverApplied = undefined;
		this.pendAllSubtasks(task.subtasks);
		this.emitChange();
	}

	/** Marks a task as skipped. */
	skipTask(id: string): void {
		const task = this.getTask(id);
		if (task === undefined) return;
		this.pushUndo();
		task.status = 'skipped';
		task.completedAt = Date.now();
		this.emitChange();
	}

	/** Resets a task to pending, clearing timing data. */
	resetToPending(id: string): void {
		const task = this.getTask(id);
		if (task === undefined || task.status === 'pending') return;
		this.pushUndo();
		task.status = 'pending';
		task.startedAt = undefined;
		task.completedAt = undefined;
		task.actualEndTime = undefined;
		task.rolloverApplied = undefined;
		task.actualDurationMinutes = undefined;
		this.pendAllSubtasks(task.subtasks);
		this.emitChange();
	}

	/** Moves a task to the front of the order. */
	moveToFront(id: string): void {
		const task = this.getTask(id);
		if (task === undefined) return;
		const minOrder = this.tasks.reduce((min, t) => Math.min(min, t.order), 0);
		task.order = minOrder - 1;
		this.emitChange();
	}

	/** Reorders a task up or down in the list. */
	reorder(id: string, direction: 'up' | 'down'): void {
		const sorted = this.getTasks();
		const idx = sorted.findIndex((t) => t.id === id);
		if (idx === -1) return;

		const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
		if (swapIdx < 0 || swapIdx >= sorted.length) return;

		this.pushUndo();
		const tempOrder = sorted[idx].order;
		sorted[idx].order = sorted[swapIdx].order;
		sorted[swapIdx].order = tempOrder;

		this.emitChange();
	}

	/** Moves a task relative to another (before or after). */
	moveTask(sourceId: string, targetId: string, before: boolean): void {
		const sorted = this.getTasks();
		const sourceIdx = sorted.findIndex((t) => t.id === sourceId);
		const targetIdx = sorted.findIndex((t) => t.id === targetId);
		if (sourceIdx === -1 || targetIdx === -1 || sourceIdx === targetIdx) return;

		this.pushUndo();
		const [source] = sorted.splice(sourceIdx, 1);
		const newTargetIdx = sorted.findIndex((t) => t.id === targetId);
		const insertAt = before ? newTargetIdx : newTargetIdx + 1;
		sorted.splice(insertAt, 0, source);

		sorted.forEach((t, i) => { t.order = i; });
		this.emitChange();
	}

	/** Resets all tasks to pending. */
	resetAll(): void {
		this.pushUndo();
		for (const task of this.tasks) {
			task.status = 'pending';
			task.startedAt = undefined;
			task.completedAt = undefined;
			task.actualEndTime = undefined;
			task.rolloverApplied = undefined;
			this.pendAllSubtasks(task.subtasks);
		}
		this.emitChange();
	}

	/** Removes completed and skipped tasks (no undo). */
	clearCompleted(): void {
		this.tasks = this.tasks.filter((t) => t.status !== 'completed' && t.status !== 'skipped');
		this.reindex();
		this.emitChange();
	}

	/** Moves completed and skipped tasks to the archive. */
	archiveCompleted(): void {
		this.pushUndo();
		const completed = this.tasks.filter((t) => t.status === 'completed' || t.status === 'skipped');
		this.archivedTasks.push(...completed);
		this.tasks = this.tasks.filter((t) => t.status !== 'completed' && t.status !== 'skipped');
		this.reindex();
		this.emitChange();
	}

	/** Returns a copy of archived tasks. */
	getArchivedTasks(): Task[] {
		return [...this.archivedTasks];
	}

	/** Permanently removes an archived task. */
	deleteArchivedTask(id: string): void {
		const idx = this.archivedTasks.findIndex((t) => t.id === id);
		if (idx === -1) return;
		this.pushUndo();
		this.archivedTasks.splice(idx, 1);
		this.emitChange();
	}

	/** Clears all archived tasks. */
	clearArchive(): void {
		if (this.archivedTasks.length === 0) return;
		this.pushUndo();
		this.archivedTasks = [];
		this.emitChange();
	}

	/** Archives completed/skipped tasks older than the given days. */
	autoArchiveStale(days: number): void {
		if (days <= 0) return;
		const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
		const stale = this.tasks.filter((t) =>
			(t.status === 'completed' || t.status === 'skipped') && t.completedAt !== undefined && t.completedAt <= cutoff,
		);
		if (stale.length === 0) return;
		this.pushUndo();
		this.archivedTasks.push(...stale);
		const staleIds = new Set(stale.map((t) => t.id));
		this.tasks = this.tasks.filter((t) => staleIds.has(t.id) === false);
		this.reindex();
		this.emitChange();
	}

	/** Restores an archived task to the active list. */
	restoreFromArchive(id: string): void {
		const idx = this.archivedTasks.findIndex((t) => t.id === id);
		if (idx === -1) return;
		this.pushUndo();
		const [task] = this.archivedTasks.splice(idx, 1);
		task.status = 'pending';
		task.completedAt = undefined;
		task.actualEndTime = undefined;
		task.startedAt = undefined;
		task.rolloverApplied = undefined;
		task.actualDurationMinutes = undefined;
		this.pendAllSubtasks(task.subtasks);
		const maxOrder = this.tasks.reduce((max, t) => Math.max(max, t.order), -1);
		task.order = maxOrder + 1;
		this.tasks.push(task);
		this.emitChange();
	}

	/** Returns tasks that have the given tag. */
	getTaggedTasks(tag: string): Task[] {
		return this.getTasks().filter((t) => t.tags?.includes(tag));
	}

	/** Returns all unique tags from active and archived tasks. */
	getAllTags(): string[] {
		const tags = new Set<string>();
		for (const task of this.tasks) {
			if (task.tags) task.tags.forEach((t) => tags.add(t));
		}
		for (const task of this.archivedTasks) {
			if (task.tags) task.tags.forEach((t) => tags.add(t));
		}
		return Array.from(tags).sort();
	}

	/** Returns average estimated vs actual duration and accuracy percent. */
	getAverageAccuracy(): { avgEstimated: number; avgActual: number; accuracyPercent: number } {
		const completed = [...this.tasks, ...this.archivedTasks].filter(
			(t) => t.status === 'completed' && t.actualDurationMinutes !== undefined,
		);
		if (completed.length === 0) return { avgEstimated: 0, avgActual: 0, accuracyPercent: 100 };

		const totalEst = completed.reduce((s, t) => s + t.durationMinutes, 0);
		const totalAct = completed.reduce((s, t) => s + (t.actualDurationMinutes ?? t.durationMinutes), 0);
		const avgEst = totalEst / completed.length;
		const avgAct = totalAct / completed.length;
		const accuracy = avgEst > 0 ? Math.round((avgAct / avgEst) * 100) : 100;

		return { avgEstimated: Math.round(avgEst), avgActual: Math.round(avgAct), accuracyPercent: accuracy };
	}

	/** Saves a task as a template and returns it. */
	saveAsTemplate(taskId: string): TaskTemplate | undefined {
		const task = this.getTask(taskId);
		if (task === undefined) return undefined;
		const template: TaskTemplate = {
			id: this.generateId(),
			name: task.title,
			durationMinutes: task.durationMinutes,
			subtasks: task.subtasks ? this.cloneSubtasks(task.subtasks) : undefined,
			tags: task.tags ? [...task.tags] : undefined,
		};
		this.settings.templates.push(template);
		this.emitChange();
		return template;
	}

	/** Returns all saved templates. */
	getTemplates(): TaskTemplate[] {
		return this.settings.templates;
	}

	/** Removes a template by ID. */
	removeTemplate(id: string): void {
		this.settings.templates = this.settings.templates.filter((t) => t.id !== id);
		this.emitChange();
	}

	/** Returns the archived tasks array by reference (for direct mutation). */
	getArchivedTasksRef(): Task[] {
		return this.archivedTasks;
	}

	/** Replaces the archived tasks array. */
	setArchivedTasks(tasks: Task[]): void {
		this.archivedTasks = tasks;
	}

	private cloneSubtasks(subs: SubTask[]): SubTask[] {
		return subs.map((s) => ({
			...s,
			id: this.generateId(),
			subtasks: s.subtasks ? this.cloneSubtasks(s.subtasks) : undefined,
		}));
	}

	/** Adds a subtask under a parent path. Returns undefined if depth limit exceeded. */
	addSubTask(taskId: string, title: string, parentPath: string[] = []): SubTask | undefined {
		const task = this.getTask(taskId);
		if (task === undefined) return undefined;
		if (parentPath.length >= MAX_SUBTASK_DEPTH) return undefined;

		const newSub: SubTask = {
			id: this.generateId(),
			title,
			status: 'pending',
		};

		const parent = this.resolveSubTaskParent(task, parentPath);
		if (parent === undefined) return undefined;

		if ('subtasks' in parent && parent.subtasks) {
			parent.subtasks.push(newSub);
		} else {
			parent.subtasks = [newSub];
		}

		this.emitChange();
		return newSub;
	}

	/** Toggles a subtask's status between pending and completed. */
	toggleSubTask(taskId: string, subTaskPath: string[]): void {
		const task = this.getTask(taskId);
		if (task === undefined || subTaskPath.length === 0) return;

		const sub = this.resolveSubTask(task, subTaskPath);
		if (sub === undefined) return;

		sub.status = sub.status === 'completed' ? 'pending' : 'completed';
		this.emitChange();
	}

	/** Renames a subtask. */
	renameSubTask(taskId: string, subTaskPath: string[], newTitle: string): void {
		const task = this.getTask(taskId);
		if (task === undefined || subTaskPath.length === 0) return;
		const sub = this.resolveSubTask(task, subTaskPath);
		if (sub === undefined) return;
		sub.title = newTitle;
		this.emitChange();
	}

	/** Replaces all subtasks for a task. */
	replaceSubtasks(taskId: string, subtasks: SubTask[] | undefined): void {
		const task = this.getTask(taskId);
		if (task === undefined) return;
		task.subtasks = subtasks;
		this.emitChange();
	}

	/** Removes a subtask by path. */
	removeSubTask(taskId: string, subTaskPath: string[]): void {
		const task = this.getTask(taskId);
		if (task === undefined || subTaskPath.length === 0) return;

		const parentPath = subTaskPath.slice(0, -1);
		const targetId = subTaskPath[subTaskPath.length - 1];
		const parent = this.resolveSubTaskParent(task, parentPath);
		if (parent === undefined || parent.subtasks === undefined) return;

		parent.subtasks = parent.subtasks.filter((s) => s.id !== targetId);
		if (parent.subtasks.length === 0) {
			parent.subtasks = undefined;
		}
		this.emitChange();
	}

	private completeAllSubtasks(subtasks: SubTask[] | undefined): void {
		if (subtasks === undefined) return;
		for (const sub of subtasks) {
			sub.status = 'completed';
			this.completeAllSubtasks(sub.subtasks);
		}
	}

	private pendAllSubtasks(subtasks: SubTask[] | undefined): void {
		if (subtasks === undefined) return;
		for (const sub of subtasks) {
			sub.status = 'pending';
			this.pendAllSubtasks(sub.subtasks);
		}
	}

	private resolveSubTaskParent(task: Task, path: string[]): (Task | SubTask) | undefined {
		let current: Task | SubTask = task;
		for (const id of path) {
			if (current.subtasks === undefined) return undefined;
			const found: SubTask | undefined = current.subtasks.find((s) => s.id === id);
			if (found === undefined) return undefined;
			current = found;
		}
		return current;
	}

	private resolveSubTask(task: Task, path: string[]): SubTask | undefined {
		if (path.length === 0) return undefined;
		const parentPath = path.slice(0, -1);
		const targetId = path[path.length - 1];
		const parent = this.resolveSubTaskParent(task, parentPath);
		if (parent === undefined || parent.subtasks === undefined) return undefined;
		return parent.subtasks.find((s) => s.id === targetId);
	}

	/** Returns a shallow copy of tasks for serialization. */
	toJSON(): Task[] {
		return this.tasks.map((t) => ({ ...t }));
	}

	private reindex(): void {
		const sorted = this.getTasks();
		sorted.forEach((t, i) => {
			t.order = i;
		});
	}

	private generateId(): string {
		return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
	}

	private emitChange(): void {
		if (this.onChangeCallback) {
			this.onChangeCallback();
		}
		this.bus.emit(TaskEvents.Changed, {});
	}
}
