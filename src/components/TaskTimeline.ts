/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard Welcome
 * Description: Task list with git-style tree, duration display, actions, and subtask rendering
 * Created: 2026-03-07
 * Last Modified: 2026-03-07
 */

import { App, setIcon, TFile, Notice } from 'obsidian';
import { Task, SubTask, PluginSettings } from '../types';
import { TimerEngine } from '../TimerEngine';
import { TaskManager } from '../TaskManager';
import { SubtaskTree } from './SubtaskTree';
import { TaskModal } from '../modals/TaskModal';
import { ImportModal } from '../modals/ImportModal';
import { TimerSection } from './TimerSection';
import { ConfirmModal } from '../modals/ConfirmModal';
import { ArchiveDetailModal } from '../modals/ArchiveDetailModal';
import { AIDispatcher } from '../services/AIDispatcher';
import { AnalyticsExporter } from '../services/AnalyticsExporter';
import { attachOverflowTooltip, renderTagPills } from '../Tooltip';

export interface TaskTimelineDeps {
	app: App;
	timerEngine: TimerEngine;
	taskManager: TaskManager;
	timerSection: TimerSection;
	onRenderAll: () => void;
	saveCallback: () => void;
	settings: PluginSettings;
}

const collapsedTaskIds = new Set<string>();
let allCollapsed = false;
let showArchive = false;
let activeTagFilters: string[] = [];

export class TaskTimeline {
	private deps: TaskTimelineDeps;
	private subtaskTree: SubtaskTree;
	private draggedTaskId: string | null = null;

	constructor(deps: TaskTimelineDeps) {
		this.deps = deps;
		this.subtaskTree = new SubtaskTree(
			() => {
				this.deps.saveCallback();
				this.deps.onRenderAll();
			},
			() => {
				this.deps.taskManager.saveUndoSnapshot();
			},
		);
	}

	render(parent: HTMLElement): void {
		const section = parent.createDiv({ cls: 'vw-tasks-timeline' });

		const header = section.createDiv({ cls: 'vw-tasks-timeline-header' });
		const headerLeft = header.createDiv({ cls: 'vw-tasks-header-left' });

		const tasks = this.deps.taskManager.getTasks();
		const hasExpandable = tasks.some((t) => t.subtasks && t.subtasks.length > 0);

		if (hasExpandable) {
			const toggleBtn = headerLeft.createDiv({ cls: 'vw-tasks-collapse-toggle' });
			setIcon(toggleBtn, allCollapsed ? 'unfold-vertical' : 'fold-vertical');
			toggleBtn.setAttribute('aria-label', allCollapsed ? 'Expand all' : 'Collapse all');
			toggleBtn.setAttribute('tabindex', '0');
			toggleBtn.addEventListener('click', () => {
				if (allCollapsed) {
					collapsedTaskIds.clear();
					allCollapsed = false;
				} else {
					for (const t of tasks) {
						if (t.subtasks && t.subtasks.length > 0) collapsedTaskIds.add(t.id);
					}
					allCollapsed = true;
				}
				this.deps.onRenderAll();
			});
		}

		headerLeft.createDiv({ cls: 'vw-tasks-title', text: 'Task Timeline' });

		const allTags = this.deps.taskManager.getAllTags();
		if (allTags.length > 0) {
			this.renderTagDropdown(headerLeft, allTags);
		}

		const addBtn = headerLeft.createDiv({ cls: 'vw-tasks-add-btn' });
		setIcon(addBtn, 'plus');
		addBtn.createSpan({ text: ' Add Task' });
		addBtn.addEventListener('click', () => {
			new TaskModal(this.deps.app, null, this.deps.settings, (result) => {
				const newTask = this.deps.taskManager.addTask(result.title, result.durationMinutes, result.tags);
				if (result.subtasks) {
					this.deps.taskManager.replaceSubtasks(newTask.id, result.subtasks);
				}
				const updates: Record<string, unknown> = {};
				if (result.description) updates.description = result.description;
				if (result.linkedDocs) updates.linkedDocs = result.linkedDocs;
				if (result.images) updates.images = result.images;
				if (Object.keys(updates).length > 0) {
					this.deps.taskManager.updateTask(newTask.id, updates as Partial<Task>);
				}
				this.deps.onRenderAll();
			}, allTags, this.deps.taskManager).open();
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

		if (AIDispatcher.isEnabled(this.deps.settings)) {
			headerActions.createDiv({ cls: 'vw-header-divider' });

			if (this.deps.settings.aiAutoOrder) {
				const aiOrderBtn = headerActions.createDiv({ cls: 'vw-tasks-clear-btn' });
				setIcon(aiOrderBtn, 'sparkles');
				aiOrderBtn.setAttribute('aria-label', 'AI auto-order tasks');
				aiOrderBtn.setAttribute('tabindex', '0');
				aiOrderBtn.addEventListener('click', async () => {
					const ctx = await AIDispatcher.gatherContext(this.deps.taskManager, this.deps.app);
					const prompt = AIDispatcher.composePrompt('order', ctx);
					await AIDispatcher.dispatch(this.deps.app, this.deps.settings, prompt);
				});
			}

			if (this.deps.settings.aiAutoScheduler) {
				const aiScheduleBtn = headerActions.createDiv({ cls: 'vw-tasks-clear-btn' });
				setIcon(aiScheduleBtn, 'calendar-clock');
				aiScheduleBtn.setAttribute('aria-label', 'AI auto-schedule durations');
				aiScheduleBtn.setAttribute('tabindex', '0');
				aiScheduleBtn.addEventListener('click', async () => {
					const ctx = await AIDispatcher.gatherContext(this.deps.taskManager, this.deps.app);
					const prompt = AIDispatcher.composePrompt('schedule', ctx);
					await AIDispatcher.dispatch(this.deps.app, this.deps.settings, prompt);
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

		const exportBtn = headerActions.createDiv({ cls: 'vw-tasks-clear-btn' });
		setIcon(exportBtn, 'download');
		exportBtn.setAttribute('aria-label', 'Export analytics');
		exportBtn.setAttribute('tabindex', '0');
		exportBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			this.showExportMenu(exportBtn);
		});

		const copyBtn = headerActions.createDiv({ cls: 'vw-tasks-clear-btn' });
		setIcon(copyBtn, 'copy');
		copyBtn.setAttribute('aria-label', 'Copy all tasks to clipboard');
		copyBtn.setAttribute('tabindex', '0');
		copyBtn.addEventListener('click', () => {
			const allTasks = this.deps.taskManager.getTasks();
			const text = this.formatTasksForCopy(allTasks);
			navigator.clipboard.writeText(text).then(() => {
				new Notice('Tasks copied to clipboard');
			});
		});

		headerActions.createDiv({ cls: 'vw-header-divider' });

		const deleteCompletedBtn = headerActions.createDiv({ cls: 'vw-tasks-clear-btn vw-tasks-clear-btn-danger' });
		setIcon(deleteCompletedBtn, 'trash-2');
		deleteCompletedBtn.setAttribute('aria-label', 'Delete all completed tasks (archive)');
		deleteCompletedBtn.setAttribute('tabindex', '0');
		deleteCompletedBtn.addEventListener('click', () => {
			new ConfirmModal(this.deps.app, 'Archive Completed', 'Archive all completed and skipped tasks?', () => {
				this.deps.taskManager.archiveCompleted();
				this.deps.onRenderAll();
			}).open();
		});

		const archived = this.deps.taskManager.getArchivedTasks();
		const toggleArchive = headerActions.createDiv({ cls: 'vw-tasks-clear-btn' });
		setIcon(toggleArchive, showArchive ? 'eye-off' : 'eye');
		toggleArchive.setAttribute('aria-label', showArchive ? 'Hide archive' : 'Show archive');
		toggleArchive.setAttribute('tabindex', '0');
		toggleArchive.addEventListener('click', () => {
			showArchive = showArchive === false;
			this.deps.onRenderAll();
		});

		const body = section.createDiv({ cls: 'vw-tasks-timeline-body' });
		const tasksPane = body.createDiv({ cls: 'vw-tasks-pane' });
		this.renderTaskList(tasksPane);

		if (showArchive && archived.length > 0) {
			this.renderArchiveSection(tasksPane, archived);
		}
	}

	private showExportMenu(anchor: HTMLElement): void {
		const existing = document.querySelector('.vw-export-menu');
		if (existing) { existing.remove(); return; }

		const menu = document.createElement('div');
		menu.className = 'vw-export-menu';
		const rect = anchor.getBoundingClientRect();
		menu.style.position = 'fixed';
		menu.style.top = `${rect.bottom + 4}px`;
		menu.style.right = `${window.innerWidth - rect.right}px`;
		menu.style.zIndex = '10000';

		const csvBtn = menu.createDiv({ cls: 'vw-export-menu-item', text: 'Export CSV' });
		csvBtn.addEventListener('click', () => {
			const csv = AnalyticsExporter.exportToCSV(
				this.deps.taskManager.toJSON(),
				this.deps.taskManager.getArchivedTasks(),
			);
			AnalyticsExporter.downloadCSV(csv, 'vault-welcome-tasks.csv');
			menu.remove();
		});

		const noteBtn = menu.createDiv({ cls: 'vw-export-menu-item', text: 'Append to Daily Note' });
		noteBtn.addEventListener('click', async () => {
			await AnalyticsExporter.exportToDailyNote(this.deps.app, this.deps.taskManager.toJSON(), this.deps.settings.dailyNotesFolder);
			menu.remove();
		});

		document.body.appendChild(menu);
		const dismiss = (e: MouseEvent): void => {
			if (menu.contains(e.target as Node) === false) {
				menu.remove();
				document.removeEventListener('click', dismiss, true);
			}
		};
		setTimeout(() => document.addEventListener('click', dismiss, true), 0);
	}

	private renderTagDropdown(parent: HTMLElement, allTags: string[]): void {
		const wrapper = parent.createDiv({ cls: 'vw-tag-dropdown' });

		const trigger = wrapper.createDiv({ cls: 'vw-tag-dropdown-trigger' });
		const iconEl = trigger.createSpan({ cls: 'vw-tag-dropdown-icon' });
		setIcon(iconEl, 'tag');
		const label = activeTagFilters.length === 0
			? 'All Tags'
			: activeTagFilters.length === 1
				? activeTagFilters[0]
				: `${activeTagFilters.length} tags`;
		trigger.createSpan({ cls: 'vw-tag-dropdown-label', text: label });
		const chevron = trigger.createSpan({ cls: 'vw-tag-dropdown-chevron' });
		setIcon(chevron, 'chevron-down');

		trigger.addEventListener('click', () => {
			const existing = document.querySelector('.vw-tag-dropdown-menu');
			if (existing) { existing.remove(); return; }

			const menu = document.createElement('div');
			menu.className = 'vw-tag-dropdown-menu';
			const rect = trigger.getBoundingClientRect();
			menu.style.position = 'fixed';
			menu.style.top = `${rect.bottom + 4}px`;
			menu.style.left = `${rect.left}px`;
			menu.style.zIndex = '10000';

			const allItem = menu.createDiv({ cls: 'vw-tag-dropdown-item' });
			if (activeTagFilters.length === 0) allItem.addClass('vw-tag-dropdown-item-active');
			allItem.createSpan({ text: 'All Tags' });
			allItem.addEventListener('click', () => {
				activeTagFilters = [];
				menu.remove();
				this.deps.onRenderAll();
			});

			for (const tag of allTags) {
				const item = menu.createDiv({ cls: 'vw-tag-dropdown-item' });
				const isSelected = activeTagFilters.includes(tag);

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
						activeTagFilters = activeTagFilters.filter((t) => t !== tag);
					} else {
						activeTagFilters = [...activeTagFilters, tag];
					}
					this.deps.onRenderAll();
				});
			}

			document.body.appendChild(menu);
			const dismiss = (e: MouseEvent): void => {
				if (menu.contains(e.target as Node) === false && trigger.contains(e.target as Node) === false) {
					menu.remove();
					document.removeEventListener('click', dismiss, true);
				}
			};
			setTimeout(() => document.addEventListener('click', dismiss, true), 0);
		});
	}

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

			const dur = box.createDiv({ cls: 'vw-archive-box-dur', text: this.formatDuration(task.durationMinutes) });
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

	private renderTaskList(section: HTMLElement): void {
		let tasks = this.deps.taskManager.getTasks();
		if (activeTagFilters.length > 0) {
			tasks = tasks.filter((t) => t.tags?.some((tag) => activeTagFilters.includes(tag)));
		}
		const state = this.deps.timerEngine.getState();

		const tree = section.createDiv({ cls: 'vw-git-tree' });
		tree.createDiv({ cls: 'vw-git-trunk' });

		for (const task of tasks) {
			const node = tree.createDiv({ cls: 'vw-git-node' });
			const hasSubtasks = task.subtasks && task.subtasks.length > 0;
			const isCollapsed = collapsedTaskIds.has(task.id);

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
					});
					this.deps.taskManager.replaceSubtasks(task.id, result.subtasks);
					this.deps.onRenderAll();
				}, knownTags, this.deps.taskManager).open();
			});

			const durText = task.status === 'active' && state.isRunning
				? this.deps.timerEngine.formatRemaining()
				: this.formatDuration(task.durationMinutes);
			row.createDiv({ cls: 'vw-task-duration', text: durText });

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
				leftControls.addEventListener('click', (e) => {
					e.stopPropagation();
					if (collapsedTaskIds.has(task.id)) {
						collapsedTaskIds.delete(task.id);
					} else {
						collapsedTaskIds.add(task.id);
					}
					allCollapsed = false;
					this.deps.onRenderAll();
				});

				if (isCollapsed === false) {
					this.subtaskTree.renderBranch(content, task.subtasks!, 1);
				}
			}
		}
	}

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

	private renderTaskActions(actions: HTMLElement, task: Task): void {
		const isPending = task.status === 'pending';
		const isActive = task.status === 'active';
		const isCompleted = task.status === 'completed' || task.status === 'skipped';

		if (isPending) {
			const startBtn = this.createIconBtn(actions, 'play', 'Start task');
			startBtn.addEventListener('click', (e) => { e.stopPropagation(); this.deps.timerSection.handleStartTask(task); });

			if (AIDispatcher.isEnabled(this.deps.settings) && this.deps.settings.aiDelegation) {
				const delegateBtn = this.createIconBtn(actions, 'bot', 'Delegate to AI');
				delegateBtn.addEventListener('click', async (e) => {
					e.stopPropagation();
					this.deps.taskManager.updateTask(task.id, { delegationStatus: 'dispatched' } as Partial<Task>);
					this.deps.onRenderAll();
					const ctx = await AIDispatcher.gatherContext(this.deps.taskManager, this.deps.app);
					const prompt = AIDispatcher.composePrompt('delegate', ctx, task);
					await AIDispatcher.dispatch(this.deps.app, this.deps.settings, prompt);
				});
			}

			if (task.delegationStatus) {
				const badge = actions.createDiv({ cls: 'vw-delegation-badge' });
				const badgeIcon = badge.createSpan({ cls: 'vw-delegation-badge-icon' });
				const iconName = task.delegationStatus === 'dispatched' ? 'loader' : task.delegationStatus === 'completed' ? 'check-circle' : 'alert-circle';
				setIcon(badgeIcon, iconName);
				badge.createSpan({ cls: 'vw-delegation-badge-label', text: task.delegationStatus });
				badge.setAttribute('aria-label', `Delegation: ${task.delegationStatus}`);
			}

			const copyBtn = this.createIconBtn(actions, 'copy', 'Copy task');
			copyBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				navigator.clipboard.writeText(this.formatTasksForCopy([task])).then(() => new Notice('Task copied'));
			});

			const removeBtn = this.createIconBtn(actions, 'x', 'Remove task', true);
			removeBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				new ConfirmModal(this.deps.app, 'Remove Task', `Remove "${task.title}"?`, () => {
					this.deps.taskManager.removeTask(task.id);
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
				navigator.clipboard.writeText(this.formatTasksForCopy([task])).then(() => new Notice('Task copied'));
			});
		} else if (isCompleted) {
			const restartBtn = this.createIconBtn(actions, 'rotate-ccw', 'Reset task');
			restartBtn.addEventListener('click', (e) => { e.stopPropagation(); this.deps.timerSection.handleRestartCompleted(task); });

			const requeueBtn = this.createIconBtn(actions, 'list-start', 'Requeue to front');
			requeueBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				this.deps.taskManager.resetToPending(task.id);
				this.deps.taskManager.moveToFront(task.id);
				this.deps.onRenderAll();
			});

			const copyBtn = this.createIconBtn(actions, 'copy', 'Copy task');
			copyBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				navigator.clipboard.writeText(this.formatTasksForCopy([task])).then(() => new Notice('Task copied'));
			});

			const removeBtn = this.createIconBtn(actions, 'x', 'Remove task', true);
			removeBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				this.deps.taskManager.removeTask(task.id);
				this.deps.onRenderAll();
			});
		}
	}

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

	private showLinkedDocsPopover(anchor: HTMLElement, task: Task): void {
		const existing = document.querySelector('.vw-docs-popover');
		if (existing) { existing.remove(); return; }

		const popover = document.createElement('div');
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

		document.body.appendChild(popover);
		const dismiss = (e: MouseEvent): void => {
			if (popover.contains(e.target as Node) === false) {
				popover.remove();
				document.removeEventListener('click', dismiss, true);
			}
		};
		setTimeout(() => document.addEventListener('click', dismiss, true), 0);
	}

	private formatTasksForCopy(tasks: Task[]): string {
		const lines: string[] = [];
		for (const task of tasks) {
			const check = task.status === 'completed' ? 'x' : task.status === 'skipped' ? '-' : ' ';
			const dur = this.formatDuration(task.durationMinutes);
			const tags = task.tags?.length ? ` [${task.tags.join(', ')}]` : '';
			lines.push(`- [${check}] ${task.title} (${dur})${tags}`);
			if (task.description) {
				lines.push(`  ${task.description}`);
			}
			if (task.subtasks?.length) {
				this.formatSubtasksForCopy(task.subtasks, lines, 1);
			}
		}
		return lines.join('\n');
	}

	private formatSubtasksForCopy(subtasks: SubTask[], lines: string[], depth: number): void {
		const indent = '  '.repeat(depth);
		for (const sub of subtasks) {
			const check = sub.status === 'completed' ? 'x' : ' ';
			lines.push(`${indent}- [${check}] ${sub.title}`);
			if (sub.subtasks?.length) {
				this.formatSubtasksForCopy(sub.subtasks, lines, depth + 1);
			}
		}
	}

	private formatDuration(minutes: number): string {
		const h = Math.floor(minutes / 60);
		const m = minutes % 60;
		return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
	}
}
