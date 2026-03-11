/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard Welcome
 * Description: Plugin entry point -- registers view, commands, and manages data persistence
 * Created: 2026-03-07
 * Last Modified: 2026-03-07
 */

import { Plugin, WorkspaceLeaf, TFile } from 'obsidian';
import {
	PluginData,
	ModuleConfig,
	DEFAULT_DATA,
	DEFAULT_SETTINGS,
	VIEW_TYPE_WELCOME,
} from './core/types';
import { EventBus } from './core/EventBus';
import { TaskEvents, TaskStartPayload, TaskSkipPayload } from './core/events';
import { TimerEngine } from './core/TimerEngine';
import { TaskManager } from './core/TaskManager';
import { WelcomeView } from './WelcomeView';
import { AudioService } from './core/AudioService';
import { AIDispatcher, type IAIDispatcher } from './services/AIDispatcher';
import { ModuleRenderer } from './modules/ModuleCard';
import { ModuleRegistry } from './modules/ModuleRegistry';
import { SettingsTab } from './SettingsTab';
import { destroyTooltip } from './ui/Tooltip';

/** Plugin entry point -- registers view, commands, and manages data persistence. */
export default class VaultWelcomePlugin extends Plugin {
	/** Plugin data (tasks, archived, timer state, settings). */
	data: PluginData = DEFAULT_DATA;
	/** Event bus for task and timer events. */
	eventBus!: EventBus;
	/** Timer engine for clock-aligned and pomodoro modes. */
	timerEngine!: TimerEngine;
	/** Task manager for CRUD and undo/redo. */
	taskManager!: TaskManager;
	/** Audio service for completion and warning sounds. */
	audioService!: AudioService;
	/** Registry of dashboard modules (quick access, reports, etc.). */
	moduleRegistry!: ModuleRegistry;
	/** AI dispatch service for CLI tool integration. */
	aiDispatcher!: IAIDispatcher;
	private saveTimeout: number | null = null;
	private lastDateStr = '';
	private dayCheckInterval: number | null = null;
	private hasGoneNegative = false;

	/** Loads plugin data, initializes services, registers views/commands, and restores timer state. */
	async onload(): Promise<void> {
		await this.loadData_();

		this.eventBus = new EventBus();
		this.timerEngine = new TimerEngine(
			{ ...this.data.timerState },
			this.data.settings,
			this.eventBus,
		);
		this.taskManager = new TaskManager(this.data.tasks, this.data.archivedTasks, this.data.settings, this.eventBus);
		this.taskManager.autoArchiveStale(this.data.settings.autoArchiveDays);
		this.audioService = new AudioService(this.data.settings, this.eventBus);
		this.moduleRegistry = new ModuleRegistry();

		this.aiDispatcher = new AIDispatcher();
		if (this.data.dispatchHistory.length > 0) {
			this.aiDispatcher.hydrate(this.data.dispatchHistory);
		}
		this.aiDispatcher.onDispatchChange(() => {
			this.data.dispatchHistory = this.aiDispatcher.toJSON();
			this.scheduleSave();
		});
		this.aiDispatcher.onDispatchFinish((record) => {
			if (record.taskId) {
				this.taskManager.attachDispatchRecord(record.taskId, {
					id: record.id,
					action: record.action,
					label: record.label,
					taskId: record.taskId,
					taskTitle: record.taskTitle,
					tool: record.tool,
					status: record.status,
					startTime: record.startTime,
					endTime: record.endTime,
					error: record.error,
					vaultPath: record.vaultPath,
				});
			}
		});

		this.addSettingTab(new SettingsTab(this.app, this));

		this.timerEngine.onStateChangeCallback(() => {
			const remaining = this.timerEngine.getRemaining();
			if (remaining < 0 && this.hasGoneNegative === false) {
				this.hasGoneNegative = true;
				this.audioService.playWarning();
			}
			if (remaining >= 0) {
				this.hasGoneNegative = false;
			}
			this.scheduleSave();
		});
		this.taskManager.onChange(() => {
			this.data.tasks = this.taskManager.toJSON();
			this.data.archivedTasks = this.taskManager.getArchivedTasksRef();
			this.scheduleSave();
		});

		if (this.data.timerState.isRunning) {
			this.timerEngine.restoreFromState(this.data.timerState);
		}

		this.registerView(VIEW_TYPE_WELCOME, (leaf) => {
			return new WelcomeView(
				leaf,
				this.data,
				this.timerEngine,
				this.taskManager,
				() => this.scheduleSave(),
				this.audioService,
				this.eventBus,
				this.moduleRegistry,
				this.aiDispatcher,
			);
		});

		this.addRibbonIcon('layout-dashboard', 'Welcome Dashboard', () => {
			this.activateWelcomeLeaf();
		});

		this.addCommand({
			id: 'open-welcome-dashboard',
			name: 'Open Welcome Dashboard',
			callback: () => this.activateWelcomeLeaf(),
		});

		this.registerEvent(
			this.app.workspace.on('file-menu', (menu, file) => {
				if (file instanceof TFile) {
					menu.addItem((item) => {
						item.setTitle('Add to Quick Access')
							.setIcon('pin')
							.onClick(() => {
								if (this.data.settings.quickAccessPaths.includes(file.path) === false) {
									this.data.settings.quickAccessPaths.push(file.path);
									this.scheduleSave();
									this.refreshWelcomeViews();
								}
							});
					});
				}
			}),
		);

		this.registerObsidianProtocolHandler('vault-welcome', () => {
			this.activateWelcomeLeaf();
		});

		this.addCommand({
			id: 'start-next-task',
			name: 'Start Next Pending Task',
			callback: () => {
				const next = this.taskManager.getNextPendingTask();
				if (next === undefined) return;
				this.eventBus.emit<TaskStartPayload>(TaskEvents.Start, { task: next });
			},
		});

		this.addCommand({
			id: 'pause-resume',
			name: 'Pause / Resume Timer',
			callback: () => {
				const state = this.timerEngine.getState();
				if (state.isRunning === false) return;
				if (state.isPaused) this.timerEngine.resume();
				else this.timerEngine.pause();
				this.refreshWelcomeViews();
			},
		});

		this.addCommand({
			id: 'complete-current',
			name: 'Complete Current Task',
			callback: () => {
				if (this.timerEngine.getState().isRunning) {
					this.timerEngine.stop();
				}
			},
		});

		this.addCommand({
			id: 'skip-current',
			name: 'Skip Current Task',
			callback: () => {
				const state = this.timerEngine.getState();
				if (state.isRunning === false || state.currentTaskId === null) return;
				this.eventBus.emit<TaskSkipPayload>(TaskEvents.Skip, { taskId: state.currentTaskId });
			},
		});

		this.addCommand({
			id: 'undo',
			name: 'Undo Last Task Action',
			callback: () => {
				this.taskManager.undo();
				this.refreshWelcomeViews();
			},
		});

		this.addCommand({
			id: 'redo',
			name: 'Redo Task Action',
			callback: () => {
				this.taskManager.redo();
				this.refreshWelcomeViews();
			},
		});

		this.addCommand({
			id: 'open-add-task',
			name: 'Add New Task',
			callback: () => {
				this.activateWelcomeLeaf();
				const views = this.getWelcomeViews();
				if (views.length > 0) {
					views[0].openAddTaskModal();
				}
			},
		});

		this.app.workspace.onLayoutReady(() => {
			if (this.data.settings.autoOpenOnStartup) {
				setTimeout(() => this.ensureWelcomeLeaf(), 500);
			}
		});

		if (this.data.settings.autoPinTab) {
			this.registerEvent(
				this.app.workspace.on('layout-change', () => {
					this.enforceFirstPosition();
				}),
			);
		}

		this.lastDateStr = new Date().toDateString();
		this.dayCheckInterval = window.setInterval(() => {
			const now = new Date().toDateString();
			if (now !== this.lastDateStr) {
				this.lastDateStr = now;
				this.refreshWelcomeViews();
			}
		}, 60_000);
	}

	/** Registers a module renderer if not already present. */
	registerModule(renderer: ModuleRenderer): void {
		if (this.moduleRegistry.has(renderer.id)) return;
		this.moduleRegistry.register(renderer);
		this.refreshWelcomeViews();
	}

	/** Unregisters a module by id. */
	unregisterModule(id: string): void {
		this.moduleRegistry.unregister(id);
		this.refreshWelcomeViews();
	}

	/**
	 * Returns the module registry for external module registration.
	 * @returns ModuleRegistry instance
	 */
	getModuleRegistry(): ModuleRegistry {
		return this.moduleRegistry;
	}

	/** Tears down services, saves data, clears intervals, and detaches welcome views. */
	async onunload(): Promise<void> {
		this.timerEngine.destroy();
		this.audioService.destroy();
		this.eventBus.destroy();
		destroyTooltip();
		if (this.saveTimeout !== null) {
			window.clearTimeout(this.saveTimeout);
			await this.saveData_();
		}
		if (this.dayCheckInterval !== null) {
			window.clearInterval(this.dayCheckInterval);
		}
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_WELCOME);
	}

	private getWelcomeViews(): WelcomeView[] {
		return this.app.workspace.getLeavesOfType(VIEW_TYPE_WELCOME)
			.map((l) => l.view as WelcomeView)
			.filter((v) => v && typeof v.renderAll === 'function');
	}

	private async ensureWelcomeLeaf(): Promise<void> {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_WELCOME);
		if (leaves.length > 0) {
			if (this.data.settings.autoPinTab) {
				this.enforceFirstPosition();
			}
			return;
		}

		const leaf = this.app.workspace.getLeaf('tab');
		await leaf.setViewState({ type: VIEW_TYPE_WELCOME, active: true });

		if (this.data.settings.autoPinTab) {
			leaf.setPinned(true);
			setTimeout(() => this.enforceFirstPosition(), 100);
		}
	}

	private activateWelcomeLeaf(): void {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_WELCOME);
		if (leaves.length > 0) {
			this.app.workspace.revealLeaf(leaves[0]);
			return;
		}
		this.ensureWelcomeLeaf();
	}

	private enforceFirstPosition(): void {
		if (this.data.settings.autoPinTab === false) return;

		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_WELCOME);
		if (leaves.length === 0) return;

		const welcomeLeaf = leaves[0];
		const parent = welcomeLeaf.parent;
		if (parent === null || parent === undefined) return;

		if ('children' in parent) {
			const children = (parent as unknown as { children: WorkspaceLeaf[] }).children;
			if (Array.isArray(children)) {
				const idx = children.indexOf(welcomeLeaf);
				if (idx > 0) {
					children.splice(idx, 1);
					children.unshift(welcomeLeaf);
				}
			}
		}

		if ('tabHeaderEl' in welcomeLeaf) {
			const tabEl = (welcomeLeaf as unknown as { tabHeaderEl: HTMLElement }).tabHeaderEl;
			if (tabEl instanceof HTMLElement && tabEl.parentElement) {
				const parentEl = tabEl.parentElement;
				if (parentEl.firstChild !== tabEl) {
					parentEl.insertBefore(tabEl, parentEl.firstChild);
				}
			}
		}

		if (typeof welcomeLeaf.setPinned === 'function') {
			welcomeLeaf.setPinned(true);
		}

		const ws = this.app.workspace as unknown as Record<string, unknown>;
		if (typeof ws.requestSaveLayout === 'function') {
			(ws as unknown as { requestSaveLayout: () => void }).requestSaveLayout();
		}
	}

	/** Re-renders all open Welcome dashboard views. */
	refreshWelcomeViews(): void {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_WELCOME);
		for (const leaf of leaves) {
			const view = leaf.view as WelcomeView;
			if (view && typeof view.renderAll === 'function') {
				view.renderAll();
			}
		}
	}

	private scheduleSave(): void {
		if (this.saveTimeout !== null) {
			window.clearTimeout(this.saveTimeout);
		}
		this.saveTimeout = window.setTimeout(() => {
			this.saveData_();
			this.saveTimeout = null;
		}, 1000);
	}

	private async loadData_(): Promise<void> {
		const saved = await this.loadData();
		if (saved) {
			const mergedSettings = { ...DEFAULT_DATA.settings, ...saved.settings };

			mergedSettings.modules = DEFAULT_SETTINGS.modules.map((def) => {
				const savedMod = (saved.settings?.modules as ModuleConfig[] | undefined)
					?.find((m) => m.id === def.id);
				if (savedMod) {
					return {
						...def,
						enabled: savedMod.enabled,
						collapsed: savedMod.collapsed,
						order: savedMod.order ?? def.order,
						settings: savedMod.settings,
					};
				}
				return { ...def };
			});

			if (saved.settings?.autoOpenOnStartup !== undefined) {
				mergedSettings.autoOpenOnStartup = saved.settings.autoOpenOnStartup;
			}
			if (saved.settings?.autoPinTab !== undefined) {
				mergedSettings.autoPinTab = saved.settings.autoPinTab;
			}
			if (saved.settings?.tagColors) mergedSettings.tagColors = saved.settings.tagColors;
			if (saved.settings?.templates) mergedSettings.templates = saved.settings.templates;
			if (saved.settings?.audioEnabled !== undefined) mergedSettings.audioEnabled = saved.settings.audioEnabled;
			if (saved.settings?.audioOnComplete !== undefined) mergedSettings.audioOnComplete = saved.settings.audioOnComplete;
			if (saved.settings?.audioOnNegative !== undefined) mergedSettings.audioOnNegative = saved.settings.audioOnNegative;
			if (saved.settings?.timerMode) mergedSettings.timerMode = saved.settings.timerMode;
			if (saved.settings?.pomodoroWorkMinutes !== undefined) mergedSettings.pomodoroWorkMinutes = saved.settings.pomodoroWorkMinutes;
			if (saved.settings?.pomodoroBreakMinutes !== undefined) mergedSettings.pomodoroBreakMinutes = saved.settings.pomodoroBreakMinutes;
			if (saved.settings?.pomodoroLongBreakMinutes !== undefined) mergedSettings.pomodoroLongBreakMinutes = saved.settings.pomodoroLongBreakMinutes;
			if (saved.settings?.pomodoroLongBreakInterval !== undefined) mergedSettings.pomodoroLongBreakInterval = saved.settings.pomodoroLongBreakInterval;
			if (saved.settings?.hasSeenOnboarding !== undefined) mergedSettings.hasSeenOnboarding = saved.settings.hasSeenOnboarding;
			if (saved.settings?.moduleOrder) mergedSettings.moduleOrder = saved.settings.moduleOrder;
			if (saved.settings?.reportSources) mergedSettings.reportSources = saved.settings.reportSources;

			this.data = {
				settings: mergedSettings,
				tasks: saved.tasks ?? [],
				archivedTasks: saved.archivedTasks ?? [],
				timerState: { ...DEFAULT_DATA.timerState, ...saved.timerState },
				lastDashboardOpenedAt: saved.lastDashboardOpenedAt ?? 0,
				dispatchHistory: saved.dispatchHistory ?? [],
			};
		}
	}

	private async saveData_(): Promise<void> {
		this.data.timerState = this.timerEngine.getState();
		this.data.tasks = this.taskManager.toJSON();
		this.data.archivedTasks = this.taskManager.getArchivedTasksRef();
		this.data.dispatchHistory = this.aiDispatcher.toJSON();
		await this.saveData(this.data);
	}
}
