/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard
 * Description: Task list with git-style tree, duration display, actions, and subtask rendering
 * Created: 2026-03-07
 * Last Modified: 2026-03-09
 */

import { App, setIcon, TFile, Notice } from 'obsidian';
import { Task, PluginSettings } from '../core/types';
import { TimerEngine } from '../core/TimerEngine';
import { TaskManager } from '../core/TaskManager';
import { SubtaskTree, SubtreeViewState } from './SubtaskTree';
import { TaskModal } from '../modals/TaskModal';
import { ImportModal } from '../modals/ImportModal';
import { TimerSection } from './TimerSection';
import { ConfirmModal } from '../modals/ConfirmModal';
import { ArchiveDetailModal } from '../modals/ArchiveDetailModal';
import { isAIEnabled, gatherContext, composePrompt, parseJsonArray, type IAIDispatcher } from '../services/AIDispatcher';
import { PlanApprovalModal } from '../modals/PlanApprovalModal';
import { attachOverflowTooltip, renderTagPills } from '../ui/Tooltip';
import { TaskFormatter } from '../core/TaskFormatter';
import { DropZone } from '../ui/DropZone';
import { TaskParser } from '../services/TaskParser';
import type { SectionRenderer, SectionZone } from '../interfaces/SectionRenderer';

/** View state for the task timeline (collapse, archive, filters). */
export interface TimelineViewState {
	/** Task IDs whose subtask branches are collapsed. */
	collapsedTaskIds: Set<string>;
	/** Whether all expandable tasks are collapsed. */
	allCollapsed: boolean;
	/** Whether the archive section is visible. */
	showArchive: boolean;
	/** Tags used to filter the task list. */
	activeTagFilters: string[];
}

/**
 * Creates initial timeline view state.
 * @returns New TimelineViewState with default values
 */
export function createTimelineViewState(): TimelineViewState {
	return {
		collapsedTaskIds: new Set<string>(),
		allCollapsed: false,
		showArchive: false,
		activeTagFilters: [],
	};
}

/** Dependencies for the task timeline. */
export interface TaskTimelineDeps {
	app: App;
	timerEngine: TimerEngine;
	taskManager: TaskManager;
	timerSection: TimerSection;
	/** Invoked when the full dashboard should re-render. */
	onRenderAll: () => void;
	/** Invoked to persist plugin state. */
	saveCallback: () => void;
	settings: PluginSettings;
	viewState: TimelineViewState;
	subtreeViewState: SubtreeViewState;
	aiDispatcher: IAIDispatcher;
	/** Switches between list and board view modes. */
	onSwitchView?: (mode: 'list' | 'board') => void;
	/** When set, shows only tasks from this category with a back button. */
	categoryFilter?: string | null;
	/** Called when the user wants to go back to the board. */
	onBackToBoard?: () => void;
}

/** Task list with git-style tree, duration display, actions, and subtask rendering. */
export class TaskTimeline implements SectionRenderer {
	readonly id = 'task-timeline';
	readonly zone: SectionZone = 'right-col';
	readonly order = 0;
	private deps: TaskTimelineDeps;
	private vs: TimelineViewState;
	private subtaskTree: SubtaskTree;
	private draggedTaskId: string | null = null;

	/** Creates the task timeline with deps and initializes the subtask tree. */
	constructor(deps: TaskTimelineDeps) {
		this.deps = deps;
		this.vs = deps.viewState;
		this.subtaskTree = new SubtaskTree(
			deps.subtreeViewState,
			() => {
				this.deps.saveCallback();
				this.deps.onRenderAll();
			},
			() => {
				this.deps.taskManager.saveUndoSnapshot();
			},
		);
	}

	/**
	 * Renders the task timeline into the given parent.
	 * @param parent - Container element
	 */
	render(parent: HTMLElement): void {
		const section = parent.createDiv({ cls: 'vw-tasks-timeline' });

		const header = section.createDiv({ cls: 'vw-tasks-timeline-header' });
		const headerLeft = header.createDiv({ cls: 'vw-tasks-header-left' });

		const tasks = this.deps.taskManager.getTasks();

		// Back to board button
		const backBtn = headerLeft.createDiv({ cls: 'vw-view-toggle' });
		setIcon(backBtn, 'arrow-left');
		backBtn.setAttribute('aria-label', 'Back to board');
		backBtn.setAttribute('tabindex', '0');
		backBtn.addEventListener('click', () => this.deps.onBackToBoard?.());

		// Collapse toggle icon
		const hasExpandable = tasks.some((t) => t.subtasks && t.subtasks.length > 0);
		if (hasExpandable) {
			const toggleBtn = headerLeft.createDiv({ cls: 'vw-tasks-collapse-toggle' });
			setIcon(toggleBtn, this.vs.allCollapsed ? 'unfold-vertical' : 'fold-vertical');
			toggleBtn.setAttribute('aria-label', this.vs.allCollapsed ? 'Expand all' : 'Collapse all');
			toggleBtn.setAttribute('tabindex', '0');
			toggleBtn.addEventListener('click', () => {
				if (this.vs.allCollapsed) {
					this.vs.collapsedTaskIds.clear();
					this.vs.allCollapsed = false;
				} else {
					for (const t of tasks) {
						if (t.subtasks && t.subtasks.length > 0) this.vs.collapsedTaskIds.add(t.id);
					}
					this.vs.allCollapsed = true;
				}
				this.deps.onRenderAll();
			});
		}

		// Category name text
		const cat = this.deps.settings.taskCategories.find((c) => c.id === this.deps.categoryFilter);
		headerLeft.createDiv({ cls: 'vw-tasks-title', text: cat?.name ?? 'Category' });

		// Tag dropdown
		const allTags = this.deps.taskManager.getAllTags();
		if (allTags.length > 0) {
			this.renderTagDropdown(headerLeft, allTags);
		}

		// Add task button
		const addBtn = headerLeft.createDiv({ cls: 'vw-tasks-add-btn' });
		setIcon(addBtn, 'plus');
		addBtn.createSpan({ text: ' Add Task' });
		addBtn.addEventListener('click', () => {
			new TaskModal(this.deps.app, null, this.deps.settings, (result) => {
				const newTask = this.deps.taskManager.addTask(result.title, result.durationMinutes, result.tags);
				if (result.subtasks) {
					this.deps.taskManager.replaceSubtasks(newTask.id, result.subtasks);
				}
				if (result.description || result.linkedDocs || result.images || result.workingDirectory) {
					this.deps.taskManager.updateTask(newTask.id, {
						description: result.description,
						linkedDocs: result.linkedDocs,
						images: result.images,
						workingDirectory: result.workingDirectory,
					});
				}
				const catId = result.categoryId !== undefined ? result.categoryId : this.deps.categoryFilter;
				if (catId) {
					this.deps.taskManager.assignTaskCategory(newTask.id, catId);
				}
				this.deps.onRenderAll();
			}, allTags, this.deps.taskManager, this.deps.aiDispatcher).open();
		});

		const headerActions = header.createDiv({ cls: 'vw-tasks-header-actions' });

		const resetBtn = headerActions.createDiv({ cls: 'vw-tasks-clear-btn' });
		setIcon(resetBtn, 'rotate-ccw');
		resetBtn.setAttribute('aria-label', 'Reset all tasks to pending');
		resetBtn.setAttribute('tabindex', '0');
		resetBtn.addEventListener('click', () => {
			new ConfirmModal(this.deps.app, 'Reset All Tasks', 'Reset all tasks to pending? This will stop the active timer.', () => {
				this.deps.timerEngine.cancel();
				this.deps.timerEngine.resetRollover();
				this.deps.taskManager.resetAll();
				this.deps.saveCallback();
				this.deps.onRenderAll();
			}).open();
		});

		if (isAIEnabled(this.deps.settings)) {
			headerActions.createDiv({ cls: 'vw-header-divider' });

			if (this.deps.settings.aiAutoOrder) {
				const aiOrderBtn = headerActions.createDiv({ cls: 'vw-tasks-clear-btn' });
				setIcon(aiOrderBtn, 'sparkles');
				aiOrderBtn.setAttribute('aria-label', 'AI auto-order tasks');
				aiOrderBtn.setAttribute('tabindex', '0');
				aiOrderBtn.addEventListener('click', async () => {
					const ctx = await gatherContext(this.deps.taskManager, this.deps.app);
					const prompt = composePrompt('order', ctx);
					const recordId = await this.deps.aiDispatcher.dispatch(this.deps.app, this.deps.settings, 'order', prompt);
					if (recordId === '') return;
					const rec = this.deps.aiDispatcher.getRecord(recordId);
					if (rec?.output) {
						const ids = parseJsonArray(rec.output);
						if (ids && ids.length > 0) {
							this.deps.taskManager.reorderByIds(ids);
							this.deps.saveCallback();
							this.deps.onRenderAll();
							new Notice('Tasks reordered by AI');
						}
					}
				});
			}

		}

		headerActions.createDiv({ cls: 'vw-header-divider' });

		const importBtn = headerActions.createDiv({ cls: 'vw-tasks-clear-btn' });
		setIcon(importBtn, 'file-input');
		importBtn.setAttribute('aria-label', 'Import tasks from note');
		importBtn.setAttribute('tabindex', '0');
		importBtn.addEventListener('click', () => {
			new ImportModal(this.deps.app, (results) => {
				for (const r of results) {
					const task = this.deps.taskManager.addTask(r.title, r.durationMinutes);
					if (r.subtasks) {
						this.deps.taskManager.replaceSubtasks(task.id, r.subtasks);
					}
				}
				this.deps.onRenderAll();
			}).open();
		});

		const copyBtn = headerActions.createDiv({ cls: 'vw-tasks-clear-btn' });
		setIcon(copyBtn, 'copy');
		copyBtn.setAttribute('aria-label', 'Copy all tasks to clipboard');
		copyBtn.setAttribute('tabindex', '0');
		copyBtn.addEventListener('click', () => {
			const allTasks = this.deps.categoryFilter
				? this.deps.taskManager.getTasksByCategory(this.deps.categoryFilter)
				: this.deps.taskManager.getTasks();
			const text = TaskFormatter.formatTasks(allTasks);
			navigator.clipboard.writeText(text).then(() => {
				new Notice('Tasks copied to clipboard');
			});
		});

		headerActions.createDiv({ cls: 'vw-header-divider' });

		const deleteCompletedBtn = headerActions.createDiv({ cls: 'vw-tasks-clear-btn' });
		setIcon(deleteCompletedBtn, 'archive');
		deleteCompletedBtn.setAttribute('aria-label', 'Archive all completed');
		deleteCompletedBtn.setAttribute('tabindex', '0');
		deleteCompletedBtn.addEventListener('click', () => {
			new ConfirmModal(this.deps.app, 'Archive Completed', 'Archive all completed and skipped tasks?', () => {
				this.deps.taskManager.archiveCompleted();
				this.deps.onRenderAll();
			}).open();
		});

		const archived = this.deps.taskManager.getArchivedTasks();
		const toggleArchive = headerActions.createDiv({ cls: 'vw-tasks-clear-btn' });
		setIcon(toggleArchive, this.vs.showArchive ? 'eye-off' : 'eye');
		toggleArchive.setAttribute('aria-label', this.vs.showArchive ? 'Hide archive' : 'Show archive');
		toggleArchive.setAttribute('tabindex', '0');
		toggleArchive.addEventListener('click', () => {
			this.vs.showArchive = this.vs.showArchive === false;
			this.deps.onRenderAll();
		});

		const body = section.createDiv({ cls: 'vw-tasks-timeline-body' });
		const tasksPane = body.createDiv({ cls: 'vw-tasks-pane' });

		if (this.vs.showArchive && archived.length > 0) {
			this.renderArchiveSection(tasksPane, archived);
		} else {
			this.renderTaskList(tasksPane);
		}

		new DropZone(tasksPane, {
			accept: { text: true },
			callbacks: {
				onText: async (text) => {
					const lines = text.split('\n');
					const parsed = TaskParser.parseLines(lines);
					if (parsed.length > 0) {
						for (const item of parsed) {
							const task = this.deps.taskManager.addTask(item.title, 30);
							if (item.subtasks.length > 0) {
								this.deps.taskManager.replaceSubtasks(task.id, item.subtasks);
							}
						}
					} else {
						const title = text.trim();
						if (title !== '') this.deps.taskManager.addTask(title, 30);
					}
					this.deps.saveCallback();
					this.deps.onRenderAll();
					new Notice(`Added ${parsed.length || 1} task(s) from clipboard`);
				},
			},
			label: 'Paste or drop checklist text to add tasks',
			icon: 'clipboard-paste',
		});
	}

	/** Renders the tag filter dropdown with multi-select chips. */
	private renderTagDropdown(parent: HTMLElement, allTags: string[]): void {
		const wrapper = parent.createDiv({ cls: 'vw-tag-dropdown' });

		const trigger = wrapper.createDiv({ cls: 'vw-tag-dropdown-trigger' });
		const iconEl = trigger.createSpan({ cls: 'vw-tag-dropdown-icon' });
		setIcon(iconEl, 'tag');
		const label = this.vs.activeTagFilters.length === 0
			? 'All Tags'
			: this.vs.activeTagFilters.length === 1
				? this.vs.activeTagFilters[0]
				: `${this.vs.activeTagFilters.length} tags`;
		trigger.createSpan({ cls: 'vw-tag-dropdown-label', text: label });
		const chevron = trigger.createSpan({ cls: 'vw-tag-dropdown-chevron' });
		setIcon(chevron, 'chevron-down');

		trigger.addEventListener('click', () => {
			const tagDoc = trigger.doc;
			const existing = tagDoc.querySelector('.vw-tag-dropdown-menu');
			if (existing) { existing.remove(); return; }

			const menu = tagDoc.createElement('div') as HTMLDivElement;
			menu.className = 'vw-tag-dropdown-menu';
			const rect = trigger.getBoundingClientRect();
			menu.style.position = 'fixed';
			menu.style.top = `${rect.bottom + 4}px`;
			menu.style.left = `${rect.left}px`;
			menu.style.zIndex = '10000';

			const allItem = menu.createDiv({ cls: 'vw-tag-dropdown-item' });
			if (this.vs.activeTagFilters.length === 0) allItem.addClass('vw-tag-dropdown-item-active');
			allItem.createSpan({ text: 'All Tags' });
			allItem.addEventListener('click', () => {
				this.vs.activeTagFilters = [];
				menu.remove();
				this.deps.onRenderAll();
			});

			for (const tag of allTags) {
				const item = menu.createDiv({ cls: 'vw-tag-dropdown-item' });
				const isSelected = this.vs.activeTagFilters.includes(tag);

				const checkbox = item.createSpan({ cls: 'vw-tag-dropdown-check' });
				if (isSelected) {
					setIcon(checkbox, 'check');
					item.addClass('vw-tag-dropdown-item-active');
				}

				const color = this.deps.settings.tagColors[tag];
				const dot = item.createSpan({ cls: 'vw-tag-dropdown-dot' });
				if (color) dot.style.backgroundColor = color;
				item.createSpan({ text: tag });

				item.addEventListener('click', (e) => {
					e.stopPropagation();
					if (isSelected) {
						this.vs.activeTagFilters = this.vs.activeTagFilters.filter((t) => t !== tag);
					} else {
						this.vs.activeTagFilters = [...this.vs.activeTagFilters, tag];
					}
					this.deps.onRenderAll();
				});
			}

			tagDoc.body.appendChild(menu);
			const dismiss = (e: MouseEvent): void => {
				if (menu.contains(e.target as Node) === false && trigger.contains(e.target as Node) === false) {
					menu.remove();
					tagDoc.removeEventListener('click', dismiss, true);
				}
			};
			setTimeout(() => tagDoc.addEventListener('click', dismiss, true), 0);
		});
	}

	/** Renders the archived tasks grid with detail modals and delete controls. */
	private renderArchiveSection(parent: HTMLElement, archived: Task[]): void {
		const section = parent.createDiv({ cls: 'vw-archive-section' });
		const header = section.createDiv({ cls: 'vw-archive-header' });
		header.createSpan({ text: `Archived (${archived.length})` });

		const clearBtn = header.createDiv({ cls: 'vw-tasks-clear-btn vw-tasks-clear-btn-danger' });
		setIcon(clearBtn, 'trash-2');
		clearBtn.setAttribute('aria-label', 'Delete all archived tasks');
		clearBtn.setAttribute('tabindex', '0');
		clearBtn.addEventListener('click', () => {
			new ConfirmModal(this.deps.app, 'Delete All Archived', `Permanently delete ${archived.length} archived task(s)?`, () => {
				this.deps.taskManager.clearArchive();
				this.deps.onRenderAll();
			}).open();
		});

		const grid = section.createDiv({ cls: 'vw-archive-grid' });
		for (const task of archived) {
			const box = grid.createDiv({ cls: 'vw-archive-box' });
			box.addEventListener('click', () => {
				new ArchiveDetailModal(this.deps.app, task, this.deps.settings, () => {
					this.deps.taskManager.restoreFromArchive(task.id);
					this.deps.onRenderAll();
				}, () => {
					this.deps.taskManager.deleteArchivedTask(task.id);
					this.deps.onRenderAll();
				}).open();
			});

			const dur = box.createDiv({ cls: 'vw-archive-box-dur', text: TaskFormatter.formatDuration(task.durationMinutes) });
			if (task.status === 'skipped') dur.addClass('vw-archive-box-skipped');

			const name = box.createDiv({ cls: 'vw-archive-box-name', text: task.title });
			attachOverflowTooltip(name, task.title);

			if (task.tags && task.tags.length > 0) {
				renderTagPills(box, task.tags, this.deps.settings.tagColors);
			}

			if (task.completedAt) {
				box.createDiv({
					cls: 'vw-archive-box-date',
					text: new Date(task.completedAt).toLocaleDateString(),
				});
			}
		}
	}

	/** Renders the git-style task tree with dots, subtask branches, and drag reordering. */
	private renderTaskList(section: HTMLElement): void {
		let tasks = this.deps.categoryFilter
			? this.deps.taskManager.getTasksByCategory(this.deps.categoryFilter)
			: this.deps.taskManager.getTasks();
		if (this.vs.activeTagFilters.length > 0) {
			tasks = tasks.filter((t) => t.tags?.some((tag) => this.vs.activeTagFilters.includes(tag)));
		}
		const state = this.deps.timerEngine.getState();

		const tree = section.createDiv({ cls: 'vw-git-tree' });
		tree.createDiv({ cls: 'vw-git-trunk' });

		for (const task of tasks) {
			const node = tree.createDiv({ cls: 'vw-git-node' });
			const hasSubtasks = task.subtasks && task.subtasks.length > 0;
			const isDone = task.status === 'completed' || task.status === 'skipped';
			const isCollapsed = isDone || this.vs.collapsedTaskIds.has(task.id);

			const leftControls = node.createDiv({ cls: 'vw-task-left-controls' });

			const dotCls = task.status === 'active'
				? 'vw-git-dot vw-git-dot-active'
				: (task.status === 'completed' || task.status === 'skipped')
					? 'vw-git-dot vw-git-dot-completed'
					: 'vw-git-dot vw-git-dot-pending';
			const dotEl = node.createDiv({ cls: dotCls });

			if (task.status === 'active') {
				dotEl.setAttribute('aria-label', 'Complete task');
				dotEl.addEventListener('click', () => {
					this.deps.timerEngine.stop();
				});
			} else if (task.status === 'pending') {
				dotEl.setAttribute('aria-label', 'Mark complete');
				dotEl.addEventListener('click', () => {
					this.deps.taskManager.completeTask(task.id, Date.now());
					this.deps.saveCallback();
					this.deps.onRenderAll();
				});
			} else if (task.status === 'completed' || task.status === 'skipped') {
				dotEl.setAttribute('aria-label', 'Mark pending');
				dotEl.addEventListener('click', () => {
					this.deps.taskManager.uncompleteTask(task.id);
					this.deps.onRenderAll();
				});
			}

			const content = node.createDiv({ cls: 'vw-git-node-content' });
			const row = content.createDiv({ cls: 'vw-task-row' });

			this.setupTaskDrag(node, row, task.id, tree);

			if (task.status === 'active') row.addClass('vw-task-active');
			if (task.status === 'completed' || task.status === 'skipped') row.addClass('vw-task-completed');

			row.addEventListener('click', () => {
				const knownTags = this.deps.taskManager.getAllTags();
				new TaskModal(this.deps.app, task, this.deps.settings, (result) => {
					this.deps.taskManager.updateTask(task.id, {
						title: result.title,
						description: result.description,
						durationMinutes: result.durationMinutes,
						tags: result.tags,
						linkedDocs: result.linkedDocs,
						images: result.images,
						workingDirectory: result.workingDirectory,
					});
					this.deps.taskManager.replaceSubtasks(task.id, result.subtasks);
					if (result.categoryId !== undefined) {
						this.deps.taskManager.assignTaskCategory(task.id, result.categoryId);
					}
					this.deps.onRenderAll();
				}, knownTags, this.deps.taskManager, this.deps.aiDispatcher).open();
			});

			const className = task.status === 'active' && state.isRunning ? 'vw-task-duration-allocated' : 'vw-task-duration';
			row.createDiv({ cls: className, text: TaskFormatter.formatDuration(task.durationMinutes) });

			const nameWrap = row.createDiv({ cls: 'vw-task-name-wrap' });
			const nameEl = nameWrap.createDiv({ cls: 'vw-task-name', text: task.title });
			attachOverflowTooltip(nameEl, task.title);

			if ((task.status === 'completed' || task.status === 'skipped') && task.actualDurationMinutes !== undefined) {
				const estActual = `Est ${task.durationMinutes}m / Actual ${task.actualDurationMinutes}m`;
				nameWrap.createDiv({ cls: 'vw-task-est-actual', text: estActual });
			}

			if (task.tags && task.tags.length > 0) {
				renderTagPills(row, task.tags, this.deps.settings.tagColors);
			}

			if (task.images && task.images.length > 0) {
				const imgBadge = row.createDiv({ cls: 'vw-task-docs-badge' });
				const imgBadgeIcon = imgBadge.createSpan({ cls: 'vw-task-docs-badge-icon' });
				setIcon(imgBadgeIcon, 'image');
				imgBadge.createSpan({ cls: 'vw-task-docs-badge-count', text: String(task.images.length) });
			}

			if (task.linkedDocs && task.linkedDocs.length > 0) {
				const docsBadge = row.createDiv({ cls: 'vw-task-docs-badge' });
				const badgeIcon = docsBadge.createSpan({ cls: 'vw-task-docs-badge-icon' });
				setIcon(badgeIcon, 'file-text');
				docsBadge.createSpan({ cls: 'vw-task-docs-badge-count', text: String(task.linkedDocs.length) });

				docsBadge.addEventListener('click', (e) => {
					e.stopPropagation();
					this.showLinkedDocsPopover(docsBadge, task);
				});
			}

			const actions = row.createDiv({ cls: 'vw-task-actions' });
			this.renderTaskActions(actions, task);

			if (hasSubtasks) {
				setIcon(leftControls, isCollapsed ? 'chevron-right' : 'chevron-down');
				if (isDone === false) {
					leftControls.addEventListener('click', (e) => {
						e.stopPropagation();
						if (this.vs.collapsedTaskIds.has(task.id)) {
							this.vs.collapsedTaskIds.delete(task.id);
						} else {
							this.vs.collapsedTaskIds.add(task.id);
						}
						this.vs.allCollapsed = false;
						this.deps.onRenderAll();
					});
				}

				if (isCollapsed === false) {
					this.subtaskTree.renderBranch(content, task.subtasks!, 1);
				}
			}
		}
	}

	/** Wires drag-start, drag-over, and drop handlers for task reordering. */
	private setupTaskDrag(node: HTMLElement, handle: HTMLElement, taskId: string, tree: HTMLElement): void {
		handle.addEventListener('mousedown', (e: MouseEvent) => {
			const target = e.target as HTMLElement;
			if (target.closest('.vw-task-actions') || target.closest('.vw-task-docs-badge')) return;
			node.setAttribute('draggable', 'true');
		});

		node.addEventListener('dragstart', (e: DragEvent) => {
			if (node.getAttribute('draggable') !== 'true') { e.preventDefault(); return; }
			this.draggedTaskId = taskId;
			node.addClass('vw-dragging');
			e.dataTransfer?.setData('text/plain', taskId);
			if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
		});

		node.addEventListener('dragend', () => {
			this.draggedTaskId = null;
			node.removeClass('vw-dragging');
			node.removeAttribute('draggable');
			tree.querySelectorAll('.vw-drag-above, .vw-drag-below').forEach((el) => {
				el.classList.remove('vw-drag-above', 'vw-drag-below');
			});
		});

		node.addEventListener('dragover', (e: DragEvent) => {
			if (this.draggedTaskId === null || this.draggedTaskId === taskId) return;
			e.preventDefault();
			if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
			const rect = node.getBoundingClientRect();
			const above = e.clientY < rect.top + rect.height / 2;
			node.toggleClass('vw-drag-above', above);
			node.toggleClass('vw-drag-below', above === false);
		});

		node.addEventListener('dragleave', () => {
			node.removeClass('vw-drag-above');
			node.removeClass('vw-drag-below');
		});

		node.addEventListener('drop', (e: DragEvent) => {
			e.preventDefault();
			node.removeClass('vw-drag-above');
			node.removeClass('vw-drag-below');
			if (this.draggedTaskId === null || this.draggedTaskId === taskId) return;
			const rect = node.getBoundingClientRect();
			const before = e.clientY < rect.top + rect.height / 2;
			this.deps.taskManager.moveTask(this.draggedTaskId, taskId, before);
			this.draggedTaskId = null;
			this.deps.onRenderAll();
		});
	}

	/** Renders action buttons (start, delegate, copy, archive, etc.) for a task row. */
	private renderTaskActions(actions: HTMLElement, task: Task): void {
		const isPending = task.status === 'pending';
		const isActive = task.status === 'active';
		const isCompleted = task.status === 'completed' || task.status === 'skipped';

		if (isPending) {
			const startBtn = this.createIconBtn(actions, 'play', 'Start task');
			startBtn.addEventListener('click', (e) => { e.stopPropagation(); this.deps.timerSection.handleStartTask(task); });

			if (isAIEnabled(this.deps.settings) && this.deps.settings.aiDelegation) {
				const dispatcher = this.deps.aiDispatcher;
				const delegateBtn = this.createIconBtn(actions, 'bot', 'Delegate to AI');
				delegateBtn.addEventListener('click', (e) => {
					e.stopPropagation();
					const runDelegate = async (): Promise<void> => {
						this.deps.taskManager.updateTask(task.id, { delegationStatus: 'dispatched' });
						this.deps.onRenderAll();
						const ctx = await gatherContext(this.deps.taskManager, this.deps.app);
						const planId = await dispatcher.dispatchPlan(this.deps.app, this.deps.settings, ctx, task);
						if (planId === '') return;

						const unsub = dispatcher.onDispatchChange(() => {
							const rec = dispatcher.getRecord(planId);
							if (rec === undefined) return;
							if (rec.status === 'plan-ready') {
								unsub();
								new PlanApprovalModal(
									this.deps.app,
									rec,
									async () => {
										await dispatcher.dispatchExecute(this.deps.app, this.deps.settings, planId, task);
										const execRec = dispatcher.getDispatches().find((d) => d.parentPlanId === planId);
										const succeeded = execRec?.status === 'completed';
										this.deps.taskManager.updateTask(task.id, {
											delegationStatus: succeeded ? 'completed' : 'failed',
											delegationFeedback: succeeded ? undefined : execRec?.error,
										});
										this.deps.onRenderAll();
									},
									() => {
										dispatcher.rejectPlan(planId);
										this.deps.taskManager.updateTask(task.id, { delegationStatus: undefined, delegationFeedback: undefined });
										this.deps.onRenderAll();
									},
								).open();
							} else if (rec.status === 'failed') {
								unsub();
								this.deps.taskManager.updateTask(task.id, {
									delegationStatus: 'failed',
									delegationFeedback: rec.error ?? 'Plan generation failed',
								});
								this.deps.onRenderAll();
							}
						});
					};
					if (this.deps.settings.aiSkipPermissions) {
						new ConfirmModal(
							this.deps.app,
							'Unrestricted Permissions',
							'This dispatch will run with --dangerously-skip-permissions. The AI tool will have unrestricted filesystem and shell access. Continue?',
							() => { runDelegate(); },
							'Continue',
						).open();
					} else {
						runDelegate();
					}
				});
			}

			if (task.delegationStatus) {
				const isFailed = task.delegationStatus === 'failed';
				const badge = actions.createDiv({ cls: `vw-delegation-badge${isFailed ? ' vw-delegation-badge--failed' : ''}` });
				const badgeIcon = badge.createSpan({ cls: 'vw-delegation-badge-icon' });
				const iconName = task.delegationStatus === 'dispatched' ? 'loader' : task.delegationStatus === 'completed' ? 'check-circle' : 'alert-circle';
				setIcon(badgeIcon, iconName);
				badge.createSpan({ cls: 'vw-delegation-badge-label', text: task.delegationStatus.toUpperCase() });

				if (isFailed && task.delegationFeedback) {
					badge.setAttribute('aria-label', task.delegationFeedback);
					badge.style.cursor = 'pointer';
					badge.tabIndex = 0;
					badge.addEventListener('click', (e) => {
						e.stopPropagation();
						navigator.clipboard.writeText(task.delegationFeedback!).then(() => new Notice('Error copied to clipboard'));
					});
					badge.addEventListener('keydown', (e) => {
						if (e.key === 'Enter' || e.key === ' ') {
							e.stopPropagation();
							e.preventDefault();
							navigator.clipboard.writeText(task.delegationFeedback!).then(() => new Notice('Error copied to clipboard'));
						}
					});
				} else if (task.delegationStatus !== 'completed') {
					badge.setAttribute('aria-label', `Delegation: ${task.delegationStatus}`);
				}
			}

			const copyBtn = this.createIconBtn(actions, 'copy', 'Copy task');
			copyBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				navigator.clipboard.writeText(TaskFormatter.formatTasks([task])).then(() => new Notice('Task copied'));
			});

			const archiveBtn = this.createIconBtn(actions, 'archive', 'Archive task', true);
			archiveBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				new ConfirmModal(this.deps.app, 'Archive Task', `Archive "${task.title}"?`, () => {
					this.deps.taskManager.archiveTask(task.id);
					this.deps.saveCallback();
					this.deps.onRenderAll();
				}).open();
			});
		} else if (isActive) {
			const completeBtn = this.createIconBtn(actions, 'check', 'Complete task');
			completeBtn.addEventListener('click', (e) => { e.stopPropagation(); this.deps.timerEngine.stop(); });

			const restartBtn = this.createIconBtn(actions, 'rotate-ccw', 'Restart task');
			restartBtn.addEventListener('click', (e) => { e.stopPropagation(); this.deps.timerSection.handleRestartActive(); });

			const skipBtn = this.createIconBtn(actions, 'skip-forward', 'Skip task');
			skipBtn.addEventListener('click', (e) => { e.stopPropagation(); this.deps.timerSection.handleSkipActive(); });

			const copyBtn = this.createIconBtn(actions, 'copy', 'Copy task');
			copyBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				navigator.clipboard.writeText(TaskFormatter.formatTasks([task])).then(() => new Notice('Task copied'));
			});
		} else if (isCompleted) {
			const restartBtn = this.createIconBtn(actions, 'rotate-ccw', 'Reset task');
			restartBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				new ConfirmModal(this.deps.app, 'Reset Task', `Reset "${task.title}" back to pending?`, () => {
					this.deps.timerSection.handleRestartCompleted(task);
				}).open();
			});

			const copyBtn = this.createIconBtn(actions, 'copy', 'Copy task');
			copyBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				navigator.clipboard.writeText(TaskFormatter.formatTasks([task])).then(() => new Notice('Task copied'));
			});

			const archiveBtn = this.createIconBtn(actions, 'archive', 'Archive task', true);
			archiveBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				new ConfirmModal(this.deps.app, 'Archive Task', `Archive "${task.title}"?`, () => {
					this.deps.taskManager.archiveTask(task.id);
					this.deps.saveCallback();
					this.deps.onRenderAll();
				}).open();
			});
		}
	}

	/** Creates an accessible icon button, optionally styled as a danger action. */
	private createIconBtn(parent: HTMLElement, icon: string, label: string, danger = false): HTMLDivElement {
		const cls = danger
			? 'vw-task-action-btn vw-task-action-btn-danger'
			: 'vw-task-action-btn';
		const btn = parent.createDiv({ cls });
		setIcon(btn, icon);
		btn.setAttribute('aria-label', label);
		btn.setAttribute('tabindex', '0');
		return btn;
	}

	/** Shows a floating popover listing the task's linked documents with clickable links. */
	private showLinkedDocsPopover(anchor: HTMLElement, task: Task): void {
		const popDoc = anchor.doc;
		const existing = popDoc.querySelector('.vw-docs-popover');
		if (existing) { existing.remove(); return; }

		const popover = popDoc.createElement('div') as HTMLDivElement;
		popover.className = 'vw-docs-popover';
		const rect = anchor.getBoundingClientRect();
		popover.style.position = 'fixed';
		popover.style.top = `${rect.bottom + 4}px`;
		popover.style.left = `${rect.left}px`;
		popover.style.zIndex = '10000';

		popover.createDiv({ cls: 'vw-docs-popover-header', text: 'Linked Documents' });

		for (const docPath of task.linkedDocs ?? []) {
			const row = popover.createDiv({ cls: 'vw-docs-popover-row' });
			const iconEl = row.createSpan({ cls: 'vw-docs-popover-icon' });
			setIcon(iconEl, 'file-text');

			const fileName = docPath.split('/').pop()?.replace(/\.md$/, '') ?? docPath;
			const link = row.createSpan({ cls: 'vw-docs-popover-link', text: fileName });
			link.setAttribute('title', docPath);

			link.addEventListener('click', (e) => {
				e.stopPropagation();
				const file = this.deps.app.vault.getAbstractFileByPath(docPath);
				if (file instanceof TFile) {
					this.deps.app.workspace.openLinkText(docPath, '', false);
				}
				popover.remove();
			});
		}

		popDoc.body.appendChild(popover);
		const dismiss = (e: MouseEvent): void => {
			if (popover.contains(e.target as Node) === false) {
				popover.remove();
				popDoc.removeEventListener('click', dismiss, true);
			}
		};
		setTimeout(() => popDoc.addEventListener('click', dismiss, true), 0);
	}

}
