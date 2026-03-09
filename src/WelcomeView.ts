/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard Welcome
 * Description: Slim orchestrator view composing TimerSection, HeatmapBar, TaskTimeline, and modules
 * Created: 2026-03-07
 * Edited By: Miguel A. Lopez
 * Last Modified: 2026-03-09
 */

import { ItemView, WorkspaceLeaf } from 'obsidian';
import { ConfirmModal } from './modals/ConfirmModal';
import { PlanApprovalModal } from './modals/PlanApprovalModal';
import { VIEW_TYPE_WELCOME, PluginData, Task } from './core/types';
import { TimerEngine } from './core/TimerEngine';
import { TaskManager } from './core/TaskManager';
import { EventBus } from './core/EventBus';
import { ModuleContainer } from './modules/ModuleContainer';
import { TimerSection } from './sections/TimerSection';
import { HeatmapBar } from './sections/HeatmapBar';
import { TaskTimeline, createTimelineViewState, TimelineViewState } from './sections/TaskTimeline';
import { createSubtreeViewState, SubtreeViewState } from './sections/SubtaskTree';
import { OnboardingOverlay } from './ui/OnboardingOverlay';
import { TaskModal } from './modals/TaskModal';
import { ReportScanner } from './services/ReportScanner';
import { DailyReportModule, WeeklyReportModule } from './modules/ReportModule';
import { LastOpenedModule, QuickAccessModule } from './modules/DocumentModule';
import { DispatchModule } from './modules/DispatchModule';
import { AIDispatcher, type DispatchRecord } from './services/AIDispatcher';
import { AudioService } from './core/AudioService';
import { ModuleCard, ModuleRenderer } from './modules/ModuleCard';
import { ModuleRegistry } from './modules/ModuleRegistry';
import { generateHeatmapShades, generateBranchShades } from './core/ColorUtils';
import type { SectionRenderer, SectionZone } from './interfaces/SectionRenderer';

const ORPHAN_POPOVER_SELECTORS = '.vw-export-menu, .vw-tag-dropdown-menu, .vw-docs-popover, .vw-heatmap-tooltip';

/** Slim orchestrator view composing TimerSection, HeatmapBar, TaskTimeline, and modules. */
export class WelcomeView extends ItemView {
	private data: PluginData;
	private timerEngine: TimerEngine;
	private taskManager: TaskManager;
	private moduleContainer: ModuleContainer | null = null;
	private saveCallback: () => void;
	private audioService: AudioService;
	private eventBus: EventBus;
	private moduleRegistry: ModuleRegistry;
	private sections: SectionRenderer[] = [];
	private timerSection: TimerSection | null = null;
	private quickAccessModule: QuickAccessModule | null = null;
	private reportScanner: ReportScanner | null = null;
	private hasRenderedOnce = false;
	private timelineViewState: TimelineViewState = createTimelineViewState();
	private subtreeViewState: SubtreeViewState = createSubtreeViewState();

	constructor(
		leaf: WorkspaceLeaf,
		data: PluginData,
		timerEngine: TimerEngine,
		taskManager: TaskManager,
		saveCallback: () => void,
		audioService: AudioService,
		eventBus: EventBus,
		moduleRegistry: ModuleRegistry,
	) {
		super(leaf);
		this.data = data;
		this.timerEngine = timerEngine;
		this.taskManager = taskManager;
		this.saveCallback = saveCallback;
		this.audioService = audioService;
		this.eventBus = eventBus;
		this.moduleRegistry = moduleRegistry;
	}

	/**
	 * Returns the timer section instance, or null if not yet rendered.
	 * @returns TimerSection or null
	 */
	getTimerSection(): TimerSection | null {
		return this.timerSection;
	}

	/** Opens the add-task modal and adds the result to the task manager. */
	openAddTaskModal(): void {
		new TaskModal(this.app, null, this.data.settings, (result) => {
			const task = this.taskManager.addTask(result.title, result.durationMinutes, result.tags);
			if (result.subtasks) {
				this.taskManager.replaceSubtasks(task.id, result.subtasks);
			}
			const updates: Partial<Pick<Task, 'description' | 'linkedDocs' | 'images'>> = {};
			if (result.description) updates.description = result.description;
			if (result.linkedDocs) updates.linkedDocs = result.linkedDocs;
			if (result.images) updates.images = result.images;
			if (Object.keys(updates).length > 0) {
				this.taskManager.updateTask(task.id, updates);
			}
			this.renderAll();
		}).open();
	}

	/** @override */
	getViewType(): string {
		return VIEW_TYPE_WELCOME;
	}

	/** @override */
	getDisplayText(): string {
		return 'Welcome Dashboard';
	}

	/** @override */
	getIcon(): string {
		return 'layout-dashboard';
	}

	/**
	 * Returns the quick access module instance, or null if not yet rendered.
	 * @returns QuickAccessModule or null
	 */
	getQuickAccessModule(): QuickAccessModule | null {
		return this.quickAccessModule;
	}

	async onOpen(): Promise<void> {
		const previousOpenedAt = this.data.lastDashboardOpenedAt ?? 0;
		this.data.lastDashboardOpenedAt = Date.now();
		this.saveCallback();
		this.reportScanner = new ReportScanner(this.app, previousOpenedAt);

		this.timerEngine.onTickCallback(() => this.updateTimerDisplay());
		this.timerEngine.onCompleteCallback((taskId) => {
			this.audioService.playComplete();
			this.taskManager.completeTask(taskId, Date.now());
			this.saveCallback();
			this.renderAll();
		});

		this.timerEngine.onBreakCompleteCallback(() => {
			this.audioService.playComplete();
			this.saveCallback();
			this.renderAll();
		});

		this.taskManager.onChange(() => {
			this.data.tasks = this.taskManager.toJSON();
			this.saveCallback();
		});

		this.renderAll();
	}

	async onClose(): Promise<void> {
		if (this.moduleContainer) {
			this.moduleContainer.destroy();
		}
	}

	/** Rebuilds the entire dashboard layout (timer, heatmap, timeline, modules). */
	renderAll(): void {
		document.querySelectorAll(ORPHAN_POPOVER_SELECTORS).forEach((el) => el.remove());

		const container = this.containerEl.children[1] as HTMLElement;
		const scrollState = this.captureScrollState(container);
		container.empty();

		const root = container.createDiv({ cls: 'vw-root' });

		const cssTarget = document.body;

		const heatmapShades = generateHeatmapShades(this.data.settings.heatmapColor);
		cssTarget.style.setProperty('--vw-heatmap-1', heatmapShades[0]);
		cssTarget.style.setProperty('--vw-heatmap-2', heatmapShades[1]);
		cssTarget.style.setProperty('--vw-heatmap-3', heatmapShades[2]);
		cssTarget.style.setProperty('--vw-heatmap-4', heatmapShades[3]);

		const branchShades = generateBranchShades(this.data.settings.branchColor);
		cssTarget.style.setProperty('--vw-branch-0', branchShades[0]);
		cssTarget.style.setProperty('--vw-branch-1', branchShades[1]);
		cssTarget.style.setProperty('--vw-branch-2', branchShades[2]);
		cssTarget.style.setProperty('--vw-branch-3', branchShades[3]);

		const rightCol = root.createDiv({ cls: 'vw-right-col' });
		const topBar = rightCol.createDiv({ cls: 'vw-top-bar' });

		const removeZone = topBar.createDiv({ cls: 'vw-module-remove-zone' });
		removeZone.setText('Drop here to hide module');
		removeZone.addEventListener('dragover', (e: DragEvent) => {
			if (ModuleCard.draggedModuleId === null) return;
			e.preventDefault();
			if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
			removeZone.classList.add('vw-module-remove-zone-over');
		});
		removeZone.addEventListener('dragleave', () => {
			removeZone.classList.remove('vw-module-remove-zone-over');
		});
		removeZone.addEventListener('drop', (e: DragEvent) => {
			e.preventDefault();
			removeZone.classList.remove('vw-module-remove-zone-over', 'vw-module-remove-zone-visible');
			const draggedId = ModuleCard.draggedModuleId;
			if (draggedId === null) return;
			ModuleCard.draggedModuleId = null;
			const cfg = this.data.settings.modules.find((m) => m.id === draggedId);
			if (cfg) {
				new ConfirmModal(this.app, 'Remove Module', `Remove the "${cfg.name}" module from the dashboard?`, () => {
					cfg.enabled = false;
					this.saveCallback();
					this.renderAll();
				}).open();
			}
		});

		const leftCol = root.createDiv({ cls: 'vw-left-col' });
		const zoneEls = new Map<SectionZone, HTMLElement>([
			['top-bar', topBar],
			['right-col', rightCol],
			['left-col', leftCol],
		]);

		this.sections = this.buildSections();
		this.sections.sort((a, b) => a.order - b.order);
		this.timerSection = this.sections.find((s): s is TimerSection => s.id === 'timer') ?? null;

		for (const section of this.sections) {
			const zone = zoneEls.get(section.zone);
			if (zone) section.render(zone);
		}
		this.hasRenderedOnce = true;

		this.renderModuleArea(leftCol);

		const onboarding = new OnboardingOverlay({
			settings: this.data.settings,
			onDismiss: () => {
				this.saveCallback();
			},
		});
		if (onboarding.shouldShow() && this.taskManager.getTasks().length === 0) {
			onboarding.render(root);
		}

		requestAnimationFrame(() => this.restoreScrollState(container, scrollState));
	}

	private buildSections(): SectionRenderer[] {
		const timer = new TimerSection({
			app: this.app,
			timerEngine: this.timerEngine,
			taskManager: this.taskManager,
			eventBus: this.eventBus,
			onRenderAll: () => this.renderAll(),
			saveCallback: this.saveCallback,
			settings: this.data.settings,
		});

		const heatmap = new HeatmapBar({
			app: this.app,
			tasks: [...this.taskManager.toJSON(), ...this.taskManager.getArchivedTasks()],
			colorScheme: this.data.settings.heatmapColorScheme,
			tagFilter: this.data.settings.heatmapTagFilter,
			dailyNotesFolder: this.data.settings.dailyNotesFolder,
			skipAutoScroll: this.hasRenderedOnce,
		});

		const timeline = new TaskTimeline({
			app: this.app,
			timerEngine: this.timerEngine,
			taskManager: this.taskManager,
			timerSection: timer,
			onRenderAll: () => this.renderAll(),
			saveCallback: this.saveCallback,
			settings: this.data.settings,
			viewState: this.timelineViewState,
			subtreeViewState: this.subtreeViewState,
		});

		return [timer, heatmap, timeline];
	}

	private renderModuleArea(parent: HTMLElement): void {
		const area = parent.createDiv({ cls: 'vw-module-area' });

		this.moduleContainer = new ModuleContainer(area, this.data.settings.modules);
		this.moduleContainer.onReorderCallback((configs) => {
			this.data.settings.modules = configs;
			this.saveCallback();
		});
		this.moduleContainer.onCollapseCallback(() => {
			this.saveCallback();
		});

		this.registerBuiltinModules();

		for (const renderer of this.moduleRegistry.getAll()) {
			this.moduleContainer.registerModule(renderer);
		}

		this.moduleContainer.render();
	}

	private registerBuiltinModules(): void {
		const cfgFor = (id: string) => {
			return this.data.settings.modules.find((m) => m.id === id) ?? {
				id, name: id, enabled: true, order: 99, collapsed: false,
			};
		};

		this.quickAccessModule = new QuickAccessModule(this.app, cfgFor('quick-access'), this.data.settings.quickAccessPaths);
		this.quickAccessModule.onPathsChanged((paths) => {
			this.data.settings.quickAccessPaths = paths;
			this.saveCallback();
		});
		this.moduleRegistry.register(this.quickAccessModule);

		const scanner = this.reportScanner ?? new ReportScanner(this.app, 0);
		const reportBase = this.data.settings.reportBasePath;
		const reportConfigs = this.data.settings.reportSources;
		this.moduleRegistry.register(new DailyReportModule(this.app, cfgFor('daily-reports'), scanner, reportBase, reportConfigs));
		this.moduleRegistry.register(new WeeklyReportModule(this.app, cfgFor('weekly-reports'), scanner, reportBase, reportConfigs));
		this.moduleRegistry.register(new LastOpenedModule(this.app, cfgFor('last-opened')));

		if (AIDispatcher.isEnabled(this.data.settings)) {
			const dispatchProvider = {
				onDispatchChange: (fn: () => void) => AIDispatcher.onDispatchChange(fn),
				getDispatches: () => AIDispatcher.getDispatches(),
				clearFinished: () => AIDispatcher.clearFinished(),
				clearAll: () => AIDispatcher.clearAll(),
				openTerminal: (path: string, app: 'ghostty' | 'terminal') => AIDispatcher.openTerminal(path, app),
				completeTask: (taskId: string) => {
					const records = AIDispatcher.getDispatches()
						.filter((d) => d.taskId === taskId && d.status !== 'running')
						.map((d) => ({
							id: d.id,
							action: d.action,
							label: d.label,
							taskId: d.taskId,
							taskTitle: d.taskTitle,
							tool: d.tool,
							status: d.status,
							startTime: d.startTime,
							endTime: d.endTime,
							error: d.error,
							vaultPath: d.vaultPath,
						}));
					if (records.length > 0) {
						this.taskManager.attachDispatchRecords(taskId, records);
					}
					this.taskManager.completeTask(taskId, Date.now());
					this.saveCallback();
					this.renderAll();
				},
				approvePlan: (planId: string) => {
					const rec = AIDispatcher.getRecord(planId);
					if (rec === undefined || rec.status !== 'plan-ready') return;
					new PlanApprovalModal(
						this.app,
						rec,
						async () => {
							try {
								await AIDispatcher.dispatchExecute(this.app, this.data.settings, planId);
								if (rec.taskId) {
									this.taskManager.updateTask(rec.taskId, { delegationStatus: 'completed' } as Partial<Task>);
									this.saveCallback();
									this.renderAll();
								}
							} catch {
								if (rec.taskId) {
									this.taskManager.updateTask(rec.taskId, { delegationStatus: 'failed' } as Partial<Task>);
									this.saveCallback();
									this.renderAll();
								}
							}
						},
						() => {
							AIDispatcher.rejectPlan(planId);
							if (rec.taskId) {
								this.taskManager.updateTask(rec.taskId, { delegationStatus: undefined } as unknown as Partial<Task>);
								this.saveCallback();
								this.renderAll();
							}
						},
					).open();
				},
				rejectPlan: (planId: string) => {
					AIDispatcher.rejectPlan(planId);
					const rec = AIDispatcher.getRecord(planId);
					if (rec?.taskId) {
						this.taskManager.updateTask(rec.taskId, { delegationStatus: undefined } as unknown as Partial<Task>);
						this.saveCallback();
						this.renderAll();
					}
				},
				previewPlan: (record: DispatchRecord) => {
					new PlanApprovalModal(this.app, record, null, null).open();
				},
			};
			this.moduleRegistry.register(new DispatchModule(this.data.settings, dispatchProvider));
		}
	}

	private updateTimerDisplay(): void {
		if (this.timerSection) {
			this.timerSection.updateDisplay();
		}
		this.data.timerState = this.timerEngine.getState();
	}

	private captureScrollState(root: HTMLElement): Map<string, number> {
		const state = new Map<string, number>();
		const selectors = ['.vw-tasks-pane', '.vw-left-col'];
		for (const sel of selectors) {
			const el = root.querySelector(sel);
			if (el) state.set(sel, el.scrollTop);
		}
		root.querySelectorAll('.vw-module-body').forEach((el, i) => {
			state.set(`.vw-module-body-${i}`, el.scrollTop);
		});
		const heatmapGrid = root.querySelector('.vw-heatmap-grid');
		if (heatmapGrid) {
			state.set('.vw-heatmap-grid:scrollLeft', heatmapGrid.scrollLeft);
		}
		return state;
	}

	private restoreScrollState(root: HTMLElement, state: Map<string, number>): void {
		for (const [sel, val] of state) {
			if (sel === '.vw-heatmap-grid:scrollLeft') {
				const el = root.querySelector('.vw-heatmap-grid');
				if (el) el.scrollLeft = val;
			} else if (sel.startsWith('.vw-module-body-')) {
				const idx = parseInt(sel.split('-').pop() ?? '0');
				const els = root.querySelectorAll('.vw-module-body');
				if (els[idx]) els[idx].scrollTop = val;
			} else {
				const el = root.querySelector(sel);
				if (el) el.scrollTop = val;
			}
		}
	}
}
