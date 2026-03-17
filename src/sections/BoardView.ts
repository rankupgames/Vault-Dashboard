/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard
 * Description: Board/column view rendering tasks grouped by category
 * Created: 2026-03-13
 * Last Modified: 2026-03-13
 */

import { App, setIcon } from 'obsidian';
import { Task, TaskCategory, PluginSettings } from '../core/types';
import { TaskManager } from '../core/TaskManager';
import { TaskFormatter } from '../core/TaskFormatter';
import { TaskModal } from '../modals/TaskModal';
import { CategoryModal } from '../modals/CategoryModal';
import { setupDragHold } from '../ui/setupDragHold';
import { ConfirmModal } from '../modals/ConfirmModal';
import { attachOverflowTooltip } from '../ui/Tooltip';
import type { IAIDispatcher } from '../services/AIDispatcher';
import type { SectionRenderer, SectionZone } from '../interfaces/SectionRenderer';

/** Dependencies for the board view (subset of TaskTimelineDeps). */
export interface BoardViewDeps {
	app: App;
	taskManager: TaskManager;
	onRenderAll: () => void;
	saveCallback: () => void;
	settings: PluginSettings;
	onEditTask: (task: Task) => void;
	onSwitchView?: (mode: 'list' | 'board') => void;
	onEnterCategory?: (categoryId: string) => void;
	aiDispatcher: IAIDispatcher;
}

/** Board/column view rendering tasks grouped by category. */
export class BoardView implements SectionRenderer {
	readonly id = 'board-view';
	readonly zone: SectionZone = 'right-col';
	readonly order = 1;
	private deps: BoardViewDeps;
	private draggedTaskId: string | null = null;
	private draggedColumnId: string | null = null;

	/** Creates the board view with the given dependencies. */
	constructor(deps: BoardViewDeps) {
		this.deps = deps;
	}

	/** Renders the Kanban board with category columns into the parent element. */
	render(parent: HTMLElement): void {
		const section = parent.createDiv({ cls: 'vw-tasks-timeline' });

		const header = section.createDiv({ cls: 'vw-tasks-timeline-header' });
		const headerLeft = header.createDiv({ cls: 'vw-tasks-header-left' });
		headerLeft.createDiv({ cls: 'vw-tasks-title', text: 'Task Board' });

		const addCatBtn = headerLeft.createDiv({ cls: 'vw-view-toggle' });
		setIcon(addCatBtn, 'plus');
		addCatBtn.setAttribute('aria-label', 'Add category');
		addCatBtn.setAttribute('tabindex', '0');
		addCatBtn.addEventListener('click', () => {
			new CategoryModal(this.deps.app, 'New Category', (result) => {
				this.deps.taskManager.addCategory(result.name, result.color);
				this.deps.saveCallback();
				this.deps.onRenderAll();
			}).open();
		});

		const container = section.createDiv({ cls: 'vw-board-container' });
		const categories = this.getSortedCategories();

		for (const cat of categories) {
			const tasks = this.deps.taskManager.getTasksByCategory(cat.id);
			this.renderColumn(container, cat, tasks);
		}
	}

	/** Daily first, General second, custom boards sorted by order after. */
	private getSortedCategories(): TaskCategory[] {
		const cats = [...this.deps.settings.taskCategories];
		return cats.sort((a, b) => {
			const rankA = a.dailyReset ? 0 : a.id === 'default-general' ? 1 : 2;
			const rankB = b.dailyReset ? 0 : b.id === 'default-general' ? 1 : 2;
			if (rankA !== rankB) return rankA - rankB;
			return a.order - b.order;
		});
	}

	/** Renders a single category column with header, add/delete buttons, and task rows. */
	private renderColumn(
		container: HTMLElement,
		cat: TaskCategory,
		tasks: Task[],
	): void {
		const col = container.createDiv({ cls: 'vw-board-column' });
		col.dataset.categoryId = cat.id;
		if (cat.dailyReset) col.addClass('vw-board-column-daily');

		// Column-level drag (reorder columns)
		col.setAttribute('draggable', 'true');
		col.addEventListener('dragstart', (e: DragEvent) => {
			if (this.draggedTaskId !== null) return;
			this.draggedColumnId = cat.id;
			col.classList.add('vw-board-column-dragging');
			e.dataTransfer?.setData('text/x-column', cat.id);
			if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
		});
		col.addEventListener('dragend', () => {
			this.draggedColumnId = null;
			col.classList.remove('vw-board-column-dragging');
			container.querySelectorAll('.vw-board-column-drop-before, .vw-board-column-drop-after')
				.forEach((el) => el.classList.remove('vw-board-column-drop-before', 'vw-board-column-drop-after'));
		});
		col.addEventListener('dragover', (e: DragEvent) => {
			if (this.draggedColumnId === null || this.draggedColumnId === cat.id) return;
			e.preventDefault();
			if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
			const rect = col.getBoundingClientRect();
			const midY = rect.top + rect.height / 2;
			col.classList.toggle('vw-board-column-drop-before', e.clientY < midY);
			col.classList.toggle('vw-board-column-drop-after', e.clientY >= midY);
		});
		col.addEventListener('dragleave', () => {
			col.classList.remove('vw-board-column-drop-before', 'vw-board-column-drop-after');
		});
		col.addEventListener('drop', (e: DragEvent) => {
			e.preventDefault();
			col.classList.remove('vw-board-column-drop-before', 'vw-board-column-drop-after');
			if (this.draggedColumnId !== null && this.draggedColumnId !== cat.id) {
				this.handleColumnDrop(this.draggedColumnId, cat.id, e, col);
				this.draggedColumnId = null;
				return;
			}
			if (this.draggedTaskId !== null) {
				this.deps.taskManager.assignTaskCategory(this.draggedTaskId, cat.id);
				this.draggedTaskId = null;
				this.deps.saveCallback();
				this.deps.onRenderAll();
			}
		});

		const headerEl = col.createDiv({ cls: 'vw-board-column-header' });

		if (cat.color) {
			const accent = headerEl.createDiv({ cls: 'vw-board-column-accent' });
			accent.style.backgroundColor = cat.color;
		}

		const nameGroup = headerEl.createDiv({ cls: 'vw-board-column-name-group' });
		if (cat.dailyReset) {
			const badge = nameGroup.createSpan({ cls: 'vw-board-daily-badge' });
			setIcon(badge, 'clock');
		}
		nameGroup.createSpan({ cls: 'vw-board-column-name', text: cat.name });
		nameGroup.createSpan({ cls: 'vw-board-column-count', text: `${tasks.length}` });

		nameGroup.style.cursor = 'pointer';
		nameGroup.setAttribute('tabindex', '0');
		nameGroup.addEventListener('click', () => this.deps.onEnterCategory?.(cat.id));

		const addBtn = headerEl.createDiv({ cls: 'vw-board-column-add' });
		setIcon(addBtn, 'plus');
		addBtn.setAttribute('aria-label', `Add task to ${cat.name}`);
		addBtn.addEventListener('click', () => {
			const knownTags = this.deps.taskManager.getAllTags();
			new TaskModal(this.deps.app, null, this.deps.settings, (result) => {
				const task = this.deps.taskManager.addTask(result.title, result.durationMinutes, result.tags);
				if (result.subtasks) this.deps.taskManager.replaceSubtasks(task.id, result.subtasks);
				if (result.description || result.linkedDocs || result.images || result.workingDirectory) {
					this.deps.taskManager.updateTask(task.id, {
						description: result.description,
						linkedDocs: result.linkedDocs,
						images: result.images,
						workingDirectory: result.workingDirectory,
					});
				}
				this.deps.taskManager.assignTaskCategory(task.id, result.categoryId ?? cat.id ?? 'default-general');
				this.deps.saveCallback();
				this.deps.onRenderAll();
			}, knownTags, this.deps.taskManager, this.deps.aiDispatcher, null, cat.id).open();
		});

		if (cat.isDefault === false || cat.isDefault === undefined) {
			const delBtn = headerEl.createDiv({ cls: 'vw-board-column-add' });
			setIcon(delBtn, 'trash-2');
			delBtn.setAttribute('aria-label', `Archive tasks & delete ${cat.name}`);
			delBtn.addEventListener('click', () => {
				const doDelete = (): void => {
					this.deps.taskManager.removeCategoryWithTasks(cat.id);
					this.deps.saveCallback();
					this.deps.onRenderAll();
				};
				if (tasks.length > 0) {
					new ConfirmModal(
						this.deps.app,
						'Delete Category',
						`Delete "${cat.name}"? ${tasks.length} task(s) will be archived.`,
						doDelete,
						'Delete',
					).open();
				} else {
					doDelete();
				}
			});
		}

		const body = col.createDiv({ cls: 'vw-board-column-body' });

		body.addEventListener('dragover', (e: DragEvent) => {
			if (this.draggedTaskId === null) return;
			e.preventDefault();
			if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
			body.classList.add('vw-board-drop-target');
		});
		body.addEventListener('dragleave', () => {
			body.classList.remove('vw-board-drop-target');
		});
		body.addEventListener('drop', (e: DragEvent) => {
			e.preventDefault();
			body.classList.remove('vw-board-drop-target');
			if (this.draggedTaskId === null) return;
			this.deps.taskManager.assignTaskCategory(this.draggedTaskId, cat.id);
			this.draggedTaskId = null;
			this.deps.saveCallback();
			this.deps.onRenderAll();
		});

		if (tasks.length === 0) {
			body.createDiv({ cls: 'vw-board-empty', text: 'No tasks' });
			return;
		}

		for (const task of tasks) {
			this.renderTaskRow(body, task);
		}
	}

	/** Reorders categories when a column is dropped onto another column. */
	private handleColumnDrop(sourceId: string, targetId: string, e: DragEvent, targetEl: HTMLElement): void {
		const cats = this.getSortedCategories();
		const ordered = cats.map((c) => c.id).filter((id) => id !== sourceId);
		const targetIdx = ordered.indexOf(targetId);
		if (targetIdx === -1) return;

		const rect = targetEl.getBoundingClientRect();
		const insertBefore = e.clientY < rect.top + rect.height / 2;
		const insertIdx = insertBefore ? targetIdx : targetIdx + 1;
		ordered.splice(insertIdx, 0, sourceId);

		this.deps.taskManager.reorderCategories(ordered);
		this.deps.saveCallback();
		this.deps.onRenderAll();
	}

	/** Renders a draggable task card inside a board column. */
	private renderTaskRow(body: HTMLElement, task: Task): void {
		const row = body.createDiv({ cls: 'vw-board-task-row' });

		setupDragHold({
			grip: row,
			draggable: row,
			onDragStart: (e) => {
				this.draggedTaskId = task.id;
				row.classList.add('vw-board-dragging');
				e.dataTransfer?.setData('text/plain', task.id);
				if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
			},
			onDragEnd: () => {
				this.draggedTaskId = null;
				row.classList.remove('vw-board-dragging');
				body.doc.querySelectorAll('.vw-board-drop-target').forEach((el) => {
					el.classList.remove('vw-board-drop-target');
				});
			},
		});

		const isDone = task.status === 'completed' || task.status === 'skipped';
		if (isDone) row.addClass('vw-board-task-completed');

		if (isDone) {
			const dot = row.createDiv({ cls: 'vw-board-task-dot vw-board-task-dot-completed' });
			setIcon(dot, 'check');
		} else {
			const dotCls = task.status === 'active'
				? 'vw-board-task-dot vw-board-task-dot-active'
				: 'vw-board-task-dot vw-board-task-dot-pending';
			row.createDiv({ cls: dotCls });
		}

		const info = row.createDiv({ cls: 'vw-board-task-info' });
		const titleEl = info.createSpan({ cls: 'vw-board-task-title', text: task.title });
		attachOverflowTooltip(titleEl, task.title);

		const dur = TaskFormatter.formatDuration(task.durationMinutes);
		const meta: string[] = [dur.substring(0, 5)];
		if (task.subtasks?.length) meta.push(`${task.subtasks.length} sub`);
		if (task.tags?.length) meta.push(task.tags.join(', '));
		info.createSpan({ cls: 'vw-board-task-meta', text: meta.join(' · ') });

		// Archive button
		const archiveBtn = row.createDiv({ cls: 'vw-board-task-archive' });
		setIcon(archiveBtn, 'archive');
		archiveBtn.setAttribute('aria-label', 'Archive task');
		archiveBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			this.deps.taskManager.archiveTask(task.id);
			this.deps.saveCallback();
			this.deps.onRenderAll();
		});

		row.addEventListener('click', () => {
			this.deps.onEditTask(task);
		});
	}
}
