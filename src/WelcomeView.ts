/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard Welcome
 * Description: Slim orchestrator view composing TimerSection, HeatmapBar, TaskTimeline, and modules
 * Created: 2026-03-07
 * Edited By: Miguel A. Lopez
 * Last Modified: 2026-03-08
 */

import { ItemView, WorkspaceLeaf } from 'obsidian';
import { VIEW_TYPE_WELCOME, PluginData, Task } from './types';
import { TimerEngine } from './TimerEngine';
import { TaskManager } from './TaskManager';
import { ModuleContainer } from './ModuleContainer';
import { TimerSection } from './components/TimerSection';
import { HeatmapBar } from './components/HeatmapBar';
import { TaskTimeline } from './components/TaskTimeline';
import { OnboardingOverlay } from './components/OnboardingOverlay';
import { TaskModal } from './modals/TaskModal';
import { ReportScanner } from './ReportScanner';
import { DailyReportModule, WeeklyReportModule } from './modules/ReportModule';
import { LastOpenedModule, QuickAccessModule } from './modules/DocumentModule';
import { AudioService } from './AudioService';
import { ModuleCard, ModuleRenderer } from './components/ModuleCard';
import { generateHeatmapShades, generateBranchShades } from './ColorUtils';

const ORPHAN_POPOVER_SELECTORS = '.vw-export-menu, .vw-tag-dropdown-menu, .vw-docs-popover, .vw-heatmap-tooltip';

export class WelcomeView extends ItemView {
	private data: PluginData;
	private timerEngine: TimerEngine;
	private taskManager: TaskManager;
	private moduleContainer: ModuleContainer | null = null;
	private saveCallback: () => void;
	private audioService: AudioService;
	private externalModules: ModuleRenderer[];
	private timerSection: TimerSection | null = null;
	private heatmapBar: HeatmapBar | null = null;
	private quickAccessModule: QuickAccessModule | null = null;
	private reportScanner: ReportScanner | null = null;
	private hasRenderedOnce = false;

	constructor(
		leaf: WorkspaceLeaf,
		data: PluginData,
		timerEngine: TimerEngine,
		taskManager: TaskManager,
		saveCallback: () => void,
		audioService: AudioService,
		externalModules: ModuleRenderer[] = [],
	) {
		super(leaf);
		this.data = data;
		this.timerEngine = timerEngine;
		this.taskManager = taskManager;
		this.saveCallback = saveCallback;
		this.audioService = audioService;
		this.externalModules = externalModules;
	}

	getTimerSection(): TimerSection | null {
		return this.timerSection;
	}

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

	getViewType(): string {
		return VIEW_TYPE_WELCOME;
	}

	getDisplayText(): string {
		return 'Welcome Dashboard';
	}

	getIcon(): string {
		return 'layout-dashboard';
	}

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
				cfg.enabled = false;
				this.saveCallback();
				this.renderAll();
			}
		});

		this.timerSection = new TimerSection({
			app: this.app,
			timerEngine: this.timerEngine,
			taskManager: this.taskManager,
			onRenderAll: () => this.renderAll(),
			saveCallback: this.saveCallback,
			settings: this.data.settings,
		});
		this.timerSection.render(topBar);

		this.heatmapBar = new HeatmapBar({
			app: this.app,
			tasks: [...this.taskManager.toJSON(), ...this.taskManager.getArchivedTasks()],
			colorScheme: this.data.settings.heatmapColorScheme,
			tagFilter: this.data.settings.heatmapTagFilter,
			dailyNotesFolder: this.data.settings.dailyNotesFolder,
			skipAutoScroll: this.hasRenderedOnce,
		});
		this.heatmapBar.render(topBar);
		this.hasRenderedOnce = true;

		const taskTimeline = new TaskTimeline({
			app: this.app,
			timerEngine: this.timerEngine,
			taskManager: this.taskManager,
			timerSection: this.timerSection,
			onRenderAll: () => this.renderAll(),
			saveCallback: this.saveCallback,
			settings: this.data.settings,
		});
		taskTimeline.render(rightCol);

		const leftCol = root.createDiv({ cls: 'vw-left-col' });
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
		this.moduleContainer.registerModule(this.quickAccessModule);

		const scanner = this.reportScanner ?? new ReportScanner(this.app, 0);
		const reportBase = this.data.settings.reportBasePath;
		this.moduleContainer.registerModule(new DailyReportModule(this.app, cfgFor('daily-reports'), scanner, reportBase));
		this.moduleContainer.registerModule(new WeeklyReportModule(this.app, cfgFor('weekly-reports'), scanner, reportBase));
		this.moduleContainer.registerModule(new LastOpenedModule(this.app, cfgFor('last-opened')));

		for (const ext of this.externalModules) {
			this.moduleContainer.registerModule(ext);
		}

		this.moduleContainer.render();
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
