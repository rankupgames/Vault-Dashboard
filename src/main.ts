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
} from './types';
import { TimerEngine } from './TimerEngine';
import { TaskManager } from './TaskManager';
import { WelcomeView } from './WelcomeView';
import { AudioService } from './AudioService';
import { ModuleRenderer } from './components/ModuleCard';
import { SettingsTab } from './SettingsTab';
import { destroyTooltip } from './Tooltip';

export default class VaultWelcomePlugin extends Plugin {
	data: PluginData = DEFAULT_DATA;
	timerEngine!: TimerEngine;
	taskManager!: TaskManager;
	audioService!: AudioService;
	private externalModules: ModuleRenderer[] = [];
	private saveTimeout: number | null = null;
	private lastDateStr = '';
	private dayCheckInterval: number | null = null;
	private hasGoneNegative = false;

	async onload(): Promise<void> {
		await this.loadData_();

		this.timerEngine = new TimerEngine(
			{ ...this.data.timerState },
			this.data.settings,
		);
		this.taskManager = new TaskManager(this.data.tasks, this.data.archivedTasks, this.data.settings);
		this.taskManager.autoArchiveStale(this.data.settings.autoArchiveDays);
		this.audioService = new AudioService(this.data.settings);

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
				this.externalModules,
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
				const views = this.getWelcomeViews();
				if (views.length > 0 && views[0].getTimerSection()) {
					views[0].getTimerSection()!.handleStartTask(next);
				}
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
				const views = this.getWelcomeViews();
				if (views.length > 0 && views[0].getTimerSection()) {
					views[0].getTimerSection()!.handleSkipActive();
				}
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
					try {
						this.enforceFirstPosition();
					} catch (e) {
						console.error('vault-welcome: enforceFirstPosition error', e);
					}
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

	registerModule(renderer: ModuleRenderer): void {
		if (this.externalModules.some((m) => m.id === renderer.id)) return;
		this.externalModules.push(renderer);
		this.refreshWelcomeViews();
	}

	unregisterModule(id: string): void {
		this.externalModules = this.externalModules.filter((m) => m.id !== id);
		this.refreshWelcomeViews();
	}

	getExternalModules(): ModuleRenderer[] {
		return this.externalModules;
	}

	async onunload(): Promise<void> {
		this.timerEngine.destroy();
		this.audioService.destroy();
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

			this.data = {
				settings: mergedSettings,
				tasks: saved.tasks ?? [],
				archivedTasks: saved.archivedTasks ?? [],
				timerState: { ...DEFAULT_DATA.timerState, ...saved.timerState },
				lastDashboardOpenedAt: saved.lastDashboardOpenedAt ?? 0,
			};
		}
	}

	private async saveData_(): Promise<void> {
		this.data.timerState = this.timerEngine.getState();
		this.data.tasks = this.taskManager.toJSON();
		this.data.archivedTasks = this.taskManager.getArchivedTasksRef();
		await this.saveData(this.data);
	}
}
