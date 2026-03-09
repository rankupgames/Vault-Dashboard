/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard Welcome
 * Description: Task CRUD operations, subtask management, ordering, and state transitions
 * Created: 2026-03-07
 * Last Modified: 2026-03-07
 */

import { Task, SubTask, TaskTemplate, PluginSettings } from './types';
import { UndoManager } from './UndoManager';

const MAX_SUBTASK_DEPTH = 4;

export class TaskManager {
	private tasks: Task[];
	private archivedTasks: Task[];
	private settings: PluginSettings;
	private onChangeCallback: (() => void) | null = null;
	private undoManager: UndoManager;

	constructor(tasks: Task[], archivedTasks: Task[] = [], settings: PluginSettings) {
		this.tasks = tasks;
		this.archivedTasks = archivedTasks;
		this.settings = settings;
		this.undoManager = new UndoManager();
	}

	getUndoManager(): UndoManager {
		return this.undoManager;
	}

	onChange(cb: () => void): void {
		this.onChangeCallback = cb;
	}

	getTasks(): Task[] {
		return [...this.tasks].sort((a, b) => a.order - b.order);
	}

	getTask(id: string): Task | undefined {
		return this.tasks.find((t) => t.id === id);
	}

	getActiveTasks(): Task[] {
		return this.getTasks().filter((t) => t.status === 'active');
	}

	getPendingTasks(): Task[] {
		return this.getTasks().filter((t) => t.status === 'pending');
	}

	getNextPendingTask(): Task | undefined {
		return this.getPendingTasks()[0];
	}

	undo(): boolean {
		const snapshot = this.undoManager.undo({ tasks: this.toJSON(), archivedTasks: [...this.archivedTasks] });
		if (snapshot === undefined) return false;
		this.tasks = snapshot.tasks;
		this.archivedTasks = snapshot.archivedTasks;
		this.emitChange();
		return true;
	}

	redo(): boolean {
		const snapshot = this.undoManager.redo({ tasks: this.toJSON(), archivedTasks: [...this.archivedTasks] });
		if (snapshot === undefined) return false;
		this.tasks = snapshot.tasks;
		this.archivedTasks = snapshot.archivedTasks;
		this.emitChange();
		return true;
	}

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

	updateTask(id: string, updates: Partial<Pick<Task, 'title' | 'description' | 'durationMinutes' | 'tags' | 'linkedDocs' | 'images' | 'delegationStatus' | 'delegationFeedback'>>): void {
		const task = this.getTask(id);
		if (task === undefined) return;
		this.pushUndo();
		Object.assign(task, updates);
		this.emitChange();
	}

	addLinkedDoc(taskId: string, path: string): void {
		const task = this.getTask(taskId);
		if (task === undefined) return;
		if (task.linkedDocs === undefined) task.linkedDocs = [];
		if (task.linkedDocs.includes(path)) return;
		this.pushUndo();
		task.linkedDocs.push(path);
		this.emitChange();
	}

	removeLinkedDoc(taskId: string, path: string): void {
		const task = this.getTask(taskId);
		if (task === undefined || task.linkedDocs === undefined) return;
		this.pushUndo();
		task.linkedDocs = task.linkedDocs.filter((p) => p !== path);
		if (task.linkedDocs.length === 0) task.linkedDocs = undefined;
		this.emitChange();
	}

	removeTask(id: string): void {
		const idx = this.tasks.findIndex((t) => t.id === id);
		if (idx === -1) return;
		this.pushUndo();
		this.tasks.splice(idx, 1);
		this.emitChange();
	}

	startTask(id: string, rolloverApplied: number): void {
		const task = this.getTask(id);
		if (task === undefined || task.status !== 'pending') return;
		task.status = 'active';
		task.startedAt = Date.now();
		task.rolloverApplied = rolloverApplied;
		this.emitChange();
	}

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

	skipTask(id: string): void {
		const task = this.getTask(id);
		if (task === undefined) return;
		this.pushUndo();
		task.status = 'skipped';
		task.completedAt = Date.now();
		this.emitChange();
	}

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

	moveToFront(id: string): void {
		const task = this.getTask(id);
		if (task === undefined) return;
		const minOrder = this.tasks.reduce((min, t) => Math.min(min, t.order), 0);
		task.order = minOrder - 1;
		this.emitChange();
	}

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

	clearCompleted(): void {
		this.tasks = this.tasks.filter((t) => t.status !== 'completed' && t.status !== 'skipped');
		this.reindex();
		this.emitChange();
	}

	archiveCompleted(): void {
		this.pushUndo();
		const completed = this.tasks.filter((t) => t.status === 'completed' || t.status === 'skipped');
		this.archivedTasks.push(...completed);
		this.tasks = this.tasks.filter((t) => t.status !== 'completed' && t.status !== 'skipped');
		this.reindex();
		this.emitChange();
	}

	getArchivedTasks(): Task[] {
		return [...this.archivedTasks];
	}

	deleteArchivedTask(id: string): void {
		const idx = this.archivedTasks.findIndex((t) => t.id === id);
		if (idx === -1) return;
		this.pushUndo();
		this.archivedTasks.splice(idx, 1);
		this.emitChange();
	}

	clearArchive(): void {
		if (this.archivedTasks.length === 0) return;
		this.pushUndo();
		this.archivedTasks = [];
		this.emitChange();
	}

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

	getTaggedTasks(tag: string): Task[] {
		return this.getTasks().filter((t) => t.tags?.includes(tag));
	}

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

	getTemplates(): TaskTemplate[] {
		return this.settings.templates;
	}

	removeTemplate(id: string): void {
		this.settings.templates = this.settings.templates.filter((t) => t.id !== id);
		this.emitChange();
	}

	getArchivedTasksRef(): Task[] {
		return this.archivedTasks;
	}

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

	toggleSubTask(taskId: string, subTaskPath: string[]): void {
		const task = this.getTask(taskId);
		if (task === undefined || subTaskPath.length === 0) return;

		const sub = this.resolveSubTask(task, subTaskPath);
		if (sub === undefined) return;

		sub.status = sub.status === 'completed' ? 'pending' : 'completed';
		this.emitChange();
	}

	renameSubTask(taskId: string, subTaskPath: string[], newTitle: string): void {
		const task = this.getTask(taskId);
		if (task === undefined || subTaskPath.length === 0) return;
		const sub = this.resolveSubTask(task, subTaskPath);
		if (sub === undefined) return;
		sub.title = newTitle;
		this.emitChange();
	}

	replaceSubtasks(taskId: string, subtasks: SubTask[] | undefined): void {
		const task = this.getTask(taskId);
		if (task === undefined) return;
		task.subtasks = subtasks;
		this.emitChange();
	}

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
	}
}
