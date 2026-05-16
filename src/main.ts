/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard
 * Description: Plugin entry point -- registers view, commands, and manages data persistence
 * Created: 2026-03-07
 * Last Modified: 2026-05-16
 */

import { Notice, Plugin, WorkspaceLeaf, TFile } from 'obsidian';
import {
	AI_TOOL,
	CRON_FREQUENCY,
	CRON_WEEKDAY,
	DEFAULT_AI_PROVIDERS,
	DEFAULT_DATA,
	DEFAULT_SETTINGS,
	type AIKeychainRef,
	type AIModelOption,
	type AIProviderSettings,
	type AITool,
	type CronFrequency,
	type CronJobConfig,
	type CronWeekday,
	type GmailDigestSettings,
	type ModuleConfig,
	type PluginData,
	type PluginSettings,
	VIEW_TYPE_WELCOME,
	VIEW_TYPE_MINI_TIMER,
} from './core/types';
import { EventBus } from './core/EventBus';
import { TaskEvents, TaskStartPayload, TaskSkipPayload, TimerEvents, TimerTickPayload } from './core/events';
import { TimerEngine } from './core/TimerEngine';
import { TaskManager } from './core/TaskManager';
import { WelcomeView } from './WelcomeView';
import { MiniTimerView } from './MiniTimerView';
import { AudioService } from './core/AudioService';
import { isGhostTaskId } from './core/ghost-task';
import { AIDispatcher, normalizeOpenRouterBaseUrl, validateToolPath, type IAIDispatcher } from './services/AIDispatcher';
import { ModuleRenderer } from './modules/ModuleCard';
import { ModuleRegistry } from './modules/ModuleRegistry';
import { SettingsTab } from './SettingsTab';
import { destroyTooltip } from './ui/Tooltip';
import { closeAllModals } from './core/modal-tracker';
import { BackupService } from './services/BackupService';
import { PopoutPositionTracker, type PopoutWindowHandle } from './services/PopoutPositionTracker';

/** Minimal Electron display shape used to restore popout placement. */
interface ElectronDisplayBounds {
	/** Left coordinate of the display. */
	x: number;
	/** Top coordinate of the display. */
	y: number;
	/** Display width in pixels. */
	width: number;
	/** Display height in pixels. */
	height: number;
}

/** Minimal Electron display wrapper returned by @electron/remote. */
interface ElectronDisplay {
	/** Bounds used by PopoutPositionTracker. */
	bounds: ElectronDisplayBounds;
}

/** Minimal BrowserWindow methods used for the mini timer popout. */
interface ElectronBrowserWindow extends PopoutWindowHandle {
	/** Electron window identifier. */
	id: number;
	/** Reports whether the popout window has already been destroyed. */
	isDestroyed(): boolean;
	/** Returns current window coordinates. */
	getPosition(): number[];
	/** Moves the window to screen coordinates. */
	setPosition(x: number, y: number): void;
	/** Subscribes to Electron window events used by position tracking. */
	on(event: string, callback: () => void): void;
	/** Changes window opacity while the view initializes. */
	setOpacity(opacity: number): void;
	/** Keeps the mini timer above normal application windows. */
	setAlwaysOnTop(flag: boolean, level?: string): void;
	/** Shows the mini timer on all macOS workspaces. */
	setVisibleOnAllWorkspaces(flag: boolean, options?: { visibleOnFullScreen?: boolean }): void;
}

/** Minimal @electron/remote shape consumed by the plugin. */
interface ElectronRemoteLike {
	/** Screen API used to enumerate displays. */
	screen?: {
		/** Returns all connected displays. */
		getAllDisplays(): ElectronDisplay[];
	};
	/** BrowserWindow API used to find and configure popout windows. */
	BrowserWindow?: {
		/** Returns all active Electron browser windows. */
		getAllWindows(): ElectronBrowserWindow[];
	};
}

/** Plugin entry point -- registers view, commands, and manages data persistence. */
export default class VaultDashboardPlugin extends Plugin {
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
	/** Pending debounce handle for plugin data writes. */
	private saveTimeout: number | null = null;
	/** Last local date observed by the daily reset poller. */
	private lastDateStr = '';
	/** Timer handle for detecting local day changes. */
	private dayCheckInterval: number | null = null;
	/** Tracks whether the current timer has already played its overtime warning. */
	private hasGoneNegative = false;
	/** Persists and restores the mini timer popout position. */
	private miniTimerTracker!: PopoutPositionTracker;

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
		this.taskManager.ensureDefaultCategories();
		this.taskManager.autoArchiveStale(this.data.settings.autoArchiveDays);
		this.audioService = new AudioService(this.data.settings, this.eventBus);
		this.moduleRegistry = new ModuleRegistry();
		this.miniTimerTracker = new PopoutPositionTracker({
			initial: this.data.miniTimerPosition,
			onChange: (pos) => {
				this.data.miniTimerPosition = pos;
				this.scheduleSave();
			},
			getDisplays: () => {
				const remote = this.getElectronRemote();
				if (remote?.screen === undefined) return [];
				return remote.screen.getAllDisplays().map((display) => display.bounds);
			},
		});

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
			this.scheduleSave();
		});
		this.eventBus.on<TimerTickPayload>(TimerEvents.Tick, (payload) => {
			if (payload.isNegative && this.hasGoneNegative === false) {
				this.hasGoneNegative = true;
				this.audioService.playWarning();
			}
			if (payload.isNegative === false) {
				this.hasGoneNegative = false;
			}
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
				() => this.openMiniTimer(),
			);
		});

		this.registerView(VIEW_TYPE_MINI_TIMER, (leaf) => {
			return new MiniTimerView(
				leaf,
				this.timerEngine,
				this.taskManager,
				this.eventBus,
				() => this.scheduleSave(),
			);
		});

		this.addRibbonIcon('layout-dashboard', 'Vault Dashboard', () => {
			this.activateWelcomeLeaf();
		});

		this.addCommand({
			id: 'open-welcome-dashboard',
			name: 'Open Vault Dashboard',
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

		this.registerObsidianProtocolHandler('vault-dashboard', () => {
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
				if (isGhostTaskId(state.currentTaskId)) return;
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

		this.addCommand({
			id: 'pop-out-mini-timer',
			name: 'Pop Out Mini Timer',
			callback: () => this.openMiniTimer(),
		});

		this.app.workspace.onLayoutReady(() => {
			this.app.workspace.detachLeavesOfType(VIEW_TYPE_MINI_TIMER);

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
				this.taskManager.clearDailyTasks();
				this.saveData_();
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
		closeAllModals();
		this.miniTimerTracker.release();
		this.aiDispatcher.killAll();
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
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_MINI_TIMER);
	}

	/** Loads @electron/remote only when the desktop Electron runtime is available. */
	private getElectronRemote(): ElectronRemoteLike | null {
		if (typeof process === 'undefined' || !process.versions?.electron) return null;
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		return require('@electron/remote') as ElectronRemoteLike;
	}

	/** Opens a compact popout window with the mini timer view, restoring last known position if valid. */
	private async openMiniTimer(): Promise<void> {
		this.miniTimerTracker.release();
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_MINI_TIMER);

		const remote = this.getElectronRemote();
		const existingIds: number[] = remote?.BrowserWindow?.getAllWindows()
			?.map((w: { id: number }) => w.id) ?? [];

		const leaf = this.app.workspace.openPopoutLeaf({
			size: { width: 120, height: 160 },
		});

		await new Promise(r => setTimeout(r, 150));

		const popout = remote?.BrowserWindow?.getAllWindows()
			?.find((w: { id: number }) => existingIds.includes(w.id) === false) ?? null;
		popout?.setOpacity(0);

		await new Promise(r => setTimeout(r, 350));
		await leaf.setViewState({ type: VIEW_TYPE_MINI_TIMER, active: true });

		const view = leaf.view;
		if (view instanceof MiniTimerView) {
			view.forceRender();
		}

		const doc = view?.containerEl?.ownerDocument;
		doc?.body?.classList.add('vw-mini-headless');

		const win = doc?.defaultView;
		if (win) win.resizeTo(120, 160);

		if (popout) {
			this.miniTimerTracker.restore(popout);
			popout.setAlwaysOnTop(true, 'screen-saver');
			popout.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
			popout.setOpacity(1);
			this.miniTimerTracker.track(popout);
		}
	}

	/** Returns all open WelcomeView instances that have been fully rendered. */
	private getWelcomeViews(): WelcomeView[] {
		return this.app.workspace.getLeavesOfType(VIEW_TYPE_WELCOME)
			.map((l) => l.view as WelcomeView)
			.filter((v) => v && typeof v.renderAll === 'function');
	}

	/** Creates a welcome leaf if none exists, optionally pinning it as the first tab. */
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

	/** Reveals an existing welcome leaf or creates one if none exists. */
	private activateWelcomeLeaf(): void {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_WELCOME);
		if (leaves.length > 0) {
			this.app.workspace.revealLeaf(leaves[0]);
			return;
		}
		this.ensureWelcomeLeaf();
	}

	/** Moves the welcome leaf to the first tab position and pins it. */
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
				const leafIndex = children.indexOf(welcomeLeaf);
				if (leafIndex > 0) {
					children.splice(leafIndex, 1);
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

	/** Debounces data persistence with a 1-second delay. */
	private scheduleSave(): void {
		if (this.saveTimeout !== null) {
			window.clearTimeout(this.saveTimeout);
		}
		this.saveTimeout = window.setTimeout(() => {
			this.saveData_();
			this.saveTimeout = null;
		}, 1000);
	}

	/** Loads persisted plugin data, falling back to vault backup if primary storage is empty. */
	private async loadData_(): Promise<void> {
		let saved = await this.loadData();
		if (saved === null || saved === undefined || (saved && Object.keys(saved).length === 0)) {
			const restored = await BackupService.restore(this.app, DEFAULT_SETTINGS.outputFolder);
			if (restored) {
				saved = restored;
				new Notice('Restored dashboard data from vault backup');
			}
		}
		if (saved) {
			const mergedSettings = { ...DEFAULT_DATA.settings, ...saved.settings };
			const savedSettingsRecord = this.asRecord(saved.settings);

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

			const legacyGmailSettings = this.findModuleSettings(saved.settings?.modules, 'gmail-intelligence');

			if (saved.settings?.autoOpenOnStartup !== undefined) {
				mergedSettings.autoOpenOnStartup = saved.settings.autoOpenOnStartup;
			}
			if (saved.settings?.autoPinTab !== undefined) {
				mergedSettings.autoPinTab = saved.settings.autoPinTab;
			}
			if (saved.settings?.tagColors) mergedSettings.tagColors = saved.settings.tagColors;
			if (saved.settings?.customTags) mergedSettings.customTags = saved.settings.customTags;
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
			mergedSettings.reportSources = this.normalizeReportSources(saved.settings?.reportSources);
			mergedSettings.cronJobs = this.normalizeCronJobs(saved.settings?.cronJobs);
			mergedSettings.gmailDigest = this.normalizeGmailDigestSettings(saved.settings?.gmailDigest, legacyGmailSettings);
			mergedSettings.aiTool = this.normalizeAITool(savedSettingsRecord.aiTool);
			mergedSettings.aiProviders = this.normalizeAIProviders(
				savedSettingsRecord.aiProviders,
				savedSettingsRecord.aiTool,
				savedSettingsRecord.aiToolPath,
			);
			if (saved.settings?.taskCategories) mergedSettings.taskCategories = saved.settings.taskCategories;
			if (saved.settings?.activeCategoryId !== undefined) mergedSettings.activeCategoryId = saved.settings.activeCategoryId;

			this.validateSettings(mergedSettings);

			this.data = {
				settings: mergedSettings,
				tasks: saved.tasks ?? [],
				archivedTasks: saved.archivedTasks ?? [],
				timerState: { ...DEFAULT_DATA.timerState, ...saved.timerState },
				lastDashboardOpenedAt: saved.lastDashboardOpenedAt ?? 0,
				dispatchHistory: saved.dispatchHistory ?? [],
				miniTimerPosition: saved.miniTimerPosition ?? null,
			};
		}
	}

	/** Sanitizes loaded settings against expected types and ranges. */
	private validateSettings(s: PluginSettings): void {
		s.aiTool = this.normalizeAITool(s.aiTool);
		if (validateToolPath(s.aiToolPath) === false) s.aiToolPath = '';
		s.aiProviders = this.normalizeAIProviders(s.aiProviders, s.aiTool, s.aiToolPath);

		const validSnaps = [15, 30, 60];
		if (validSnaps.includes(s.snapIntervalMinutes) === false) s.snapIntervalMinutes = 30;

		const validTimerModes: string[] = ['clock-aligned', 'pomodoro'];
		if (validTimerModes.includes(s.timerMode) === false) s.timerMode = 'clock-aligned';

		s.pomodoroWorkMinutes = this.clamp(s.pomodoroWorkMinutes, 5, 90);
		s.pomodoroBreakMinutes = this.clamp(s.pomodoroBreakMinutes, 1, 30);
		s.pomodoroLongBreakMinutes = this.clamp(s.pomodoroLongBreakMinutes, 5, 60);
		s.pomodoroLongBreakInterval = this.clamp(s.pomodoroLongBreakInterval, 2, 8);
		s.autoArchiveDays = Math.max(0, Math.floor(s.autoArchiveDays || 0));

		s.reportSources = this.normalizeReportSources(s.reportSources);
		s.cronJobs = this.normalizeCronJobs(s.cronJobs);
		s.gmailDigest = this.normalizeGmailDigestSettings(s.gmailDigest);

		const validTerminals: string[] = ['ghostty', 'terminal'];
		if (validTerminals.includes(s.terminalApp) === false) s.terminalApp = 'ghostty';

		const validIDEs: string[] = ['cursor', 'vscode', 'none'];
		if (validIDEs.includes(s.postDispatchIDE) === false) s.postDispatchIDE = 'cursor';
	}

	/** Clamps a numeric value (or coerces non-numbers) to the given range. */
	private clamp(value: unknown, min: number, max: number): number {
		const parsedValue = typeof value === 'number' ? value : min;
		return Math.max(min, Math.min(max, Math.floor(parsedValue)));
	}

	/** Normalizes persisted Gmail tool settings while preserving legacy module-level values. */
	private normalizeGmailDigestSettings(savedSettings: unknown, legacyModuleSettings?: Record<string, unknown>): GmailDigestSettings {
		const defaults = DEFAULT_SETTINGS.gmailDigest;
		const saved = this.asRecord(savedSettings);
		const legacy = legacyModuleSettings ?? {};
		return {
			pythonPath: this.stringSetting(saved.pythonPath, this.stringSetting(legacy.pythonPath, defaults.pythonPath)),
			scriptPath: this.stringSetting(saved.scriptPath, this.stringSetting(legacy.scriptPath, defaults.scriptPath)),
			workingDirectory: this.stringSetting(
				saved.workingDirectory,
				this.stringSetting(legacy.workingDirectory, this.stringSetting(legacy.workingDir, defaults.workingDirectory)),
			),
			query: this.nonEmptyString(saved.query, this.nonEmptyString(legacy.query, defaults.query)),
			limit: this.boundedInteger(saved.limit, this.boundedInteger(legacy.limit, defaults.limit, 1, 5000), 1, 5000),
			digestDate: this.nonEmptyString(saved.digestDate, this.nonEmptyString(legacy.digestDate, defaults.digestDate)),
		};
	}

	/** Finds legacy settings stored inside a module configuration. */
	private findModuleSettings(modules: unknown, moduleId: string): Record<string, unknown> | undefined {
		if (Array.isArray(modules) === false) return undefined;
		for (const moduleConfig of modules) {
			if (typeof moduleConfig !== 'object' || moduleConfig === null) continue;
			const candidate = moduleConfig as Partial<ModuleConfig>;
			if (candidate.id === moduleId && typeof candidate.settings === 'object' && candidate.settings !== null) {
				return candidate.settings;
			}
		}
		return undefined;
	}

	/** Converts unknown persisted data into a safe object record. */
	private asRecord(value: unknown): Record<string, unknown> {
		return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
	}

	/** Returns a trimmed string setting or a fallback when the persisted value is not a string. */
	private stringSetting(value: unknown, fallback: string): string {
		return typeof value === 'string' ? value.trim() : fallback;
	}

	/** Parses and clamps integer settings loaded from persisted plugin data. */
	private boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
		const parsed = typeof value === 'number'
			? value
			: typeof value === 'string'
				? parseInt(value, 10)
				: fallback;
		if (Number.isNaN(parsed)) return fallback;
		return Math.max(min, Math.min(max, Math.floor(parsed)));
	}

	/** Maps legacy and current AI provider IDs to the supported provider constants. */
	private normalizeAITool(value: unknown): AITool {
		if (value === 'cursor') return AI_TOOL.CURSOR_SDK;
		const values = Object.values(AI_TOOL) as AITool[];
		return values.includes(value as AITool) ? value as AITool : AI_TOOL.NONE;
	}

	/** Normalizes provider-specific AI settings without ever storing secret values in plugin data. */
	private normalizeAIProviders(savedSettings: unknown, legacyTool?: unknown, legacyPath?: unknown): AIProviderSettings {
		const saved = this.asRecord(savedSettings);
		const legacyToolName = typeof legacyTool === 'string' ? legacyTool : '';
		const legacyCliPath = typeof legacyPath === 'string' && validateToolPath(legacyPath) ? legacyPath.trim() : '';
		const codex = this.asRecord(saved.codexCli);
		const claude = this.asRecord(saved.claudeCode);
		const cursor = this.asRecord(saved.cursorSdk);
		const openRouter = this.asRecord(saved.openRouter);

		return {
			cursorSdk: {
				apiKey: this.normalizeKeychainRef(cursor.apiKey, DEFAULT_AI_PROVIDERS.cursorSdk.apiKey),
				model: this.nonEmptyString(cursor.model, DEFAULT_AI_PROVIDERS.cursorSdk.model),
				models: this.normalizeModelOptions(cursor.models),
				modelsUpdatedAt: this.boundedInteger(cursor.modelsUpdatedAt, 0, 0, Number.MAX_SAFE_INTEGER),
			},
			codexCli: {
				apiKey: this.normalizeKeychainRef(codex.apiKey, DEFAULT_AI_PROVIDERS.codexCli.apiKey),
				cliPath: this.normalizeCliPath(codex.cliPath, legacyToolName === 'codex-cli' ? legacyCliPath : DEFAULT_AI_PROVIDERS.codexCli.cliPath),
				model: this.stringSetting(codex.model, DEFAULT_AI_PROVIDERS.codexCli.model),
			},
			claudeCode: {
				apiKey: this.normalizeKeychainRef(claude.apiKey, DEFAULT_AI_PROVIDERS.claudeCode.apiKey),
				cliPath: this.normalizeCliPath(claude.cliPath, legacyToolName === 'claude-code' ? legacyCliPath : DEFAULT_AI_PROVIDERS.claudeCode.cliPath),
				model: this.stringSetting(claude.model, DEFAULT_AI_PROVIDERS.claudeCode.model),
			},
			openRouter: {
				apiKey: this.normalizeKeychainRef(openRouter.apiKey, DEFAULT_AI_PROVIDERS.openRouter.apiKey),
				baseUrl: this.normalizeOpenRouterBaseUrl(openRouter.baseUrl),
				model: this.stringSetting(openRouter.model, DEFAULT_AI_PROVIDERS.openRouter.model),
				models: this.normalizeModelOptions(openRouter.models),
				modelsUpdatedAt: this.boundedInteger(openRouter.modelsUpdatedAt, 0, 0, Number.MAX_SAFE_INTEGER),
			},
		};
	}

	/** Normalizes CLI paths to the safe character subset accepted by spawn-based dispatch. */
	private normalizeCliPath(value: unknown, fallback: string): string {
		const path = this.stringSetting(value, fallback);
		return validateToolPath(path) ? path : fallback;
	}

	/** Falls back to the default OpenRouter endpoint when persisted data is malformed or unsafe. */
	private normalizeOpenRouterBaseUrl(value: unknown): string {
		const candidate = this.nonEmptyString(value, DEFAULT_AI_PROVIDERS.openRouter.baseUrl);
		try {
			return normalizeOpenRouterBaseUrl(candidate);
		} catch {
			return DEFAULT_AI_PROVIDERS.openRouter.baseUrl;
		}
	}

	/** Normalizes Keychain lookup coordinates while preserving provider defaults. */
	private normalizeKeychainRef(value: unknown, fallback: AIKeychainRef): AIKeychainRef {
		const record = this.asRecord(value);
		return {
			service: this.nonEmptyString(record.service, fallback.service),
			account: this.nonEmptyString(record.account, fallback.account),
		};
	}

	/** Normalizes cached provider model catalogs and caps their stored size. */
	private normalizeModelOptions(value: unknown): AIModelOption[] {
		if (Array.isArray(value) === false) return [];
		const normalized: AIModelOption[] = [];
		const seen = new Set<string>();
		for (const item of value) {
			const record = this.asRecord(item);
			const id = this.stringSetting(record.id, '');
			if (id.length === 0 || id.length > 256 || seen.has(id)) continue;
			seen.add(id);
			normalized.push({
				id,
				name: this.nonEmptyString(record.name, id),
			});
			if (normalized.length >= 300) break;
		}
		return normalized;
	}

	private normalizeReportSources(savedSources: unknown): PluginSettings['reportSources'] {
		const retiredBuiltInIds = new Set([
			'interview-prep',
			'daily-trends',
			'local-leads',
			'app-store-intel',
			'weekly-jobs',
			'competitor-watch',
		]);
		const defaultIds = new Set(DEFAULT_SETTINGS.reportSources.map((source) => source.id));
		const normalized = DEFAULT_SETTINGS.reportSources.map((source) => ({ ...source }));
		if (Array.isArray(savedSources) === false) return normalized;

		for (const source of savedSources) {
			if (typeof source !== 'object' || source === null) continue;
			const candidate = source as Partial<PluginSettings['reportSources'][number]>;
			if (typeof candidate.id !== 'string') continue;
			if (retiredBuiltInIds.has(candidate.id) || defaultIds.has(candidate.id)) continue;
			if (typeof candidate.label !== 'string' || typeof candidate.folder !== 'string') continue;
			normalized.push({
				id: candidate.id,
				label: candidate.label,
				folder: candidate.folder,
				patternStr: typeof candidate.patternStr === 'string' && candidate.patternStr.length > 0 && candidate.patternStr.length <= 200
					? candidate.patternStr
					: '^(.+)\\.(md|html)$',
				frequency: candidate.frequency === 'weekly' ? 'weekly' : 'daily',
				enabled: candidate.enabled === true,
			});
		}
		return normalized;
	}

	private normalizeCronJobs(savedJobs: unknown): CronJobConfig[] {
		const defaults = DEFAULT_SETTINGS.cronJobs.map((job) => ({ ...job }));
		if (Array.isArray(savedJobs) === false) return defaults;

		const savedById = new Map<string, Partial<CronJobConfig>>();
		for (const job of savedJobs) {
			if (typeof job !== 'object' || job === null) continue;
			const candidate = job as Partial<CronJobConfig>;
			if (typeof candidate.id === 'string' && candidate.id.length > 0) {
				savedById.set(candidate.id, candidate);
			}
		}

		const normalized = defaults.map((job) => this.mergeCronJob(job, savedById.get(job.id)));
		const defaultIds = new Set(defaults.map((job) => job.id));
		for (const [id, job] of savedById) {
			if (defaultIds.has(id)) continue;
			const fallback = this.mergeCronJob({
				id,
				title: id,
				description: '',
				prompt: '',
				frequency: CRON_FREQUENCY.MANUAL,
				time: '08:00',
				weekday: CRON_WEEKDAY.MONDAY,
				outputFolder: `WorkspaceVault/Personal/ClaudeCRON/${id}`,
				filePrefix: id.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || id,
				configPath: `WorkspaceVault/Personal/ClaudeCRON/Configs/${id}.md`,
				workingDirectory: '',
				enabled: false,
				createdAt: 0,
				updatedAt: 0,
			}, job);
			normalized.push(fallback);
		}
		return normalized;
	}

	private mergeCronJob(base: CronJobConfig, saved: Partial<CronJobConfig> | undefined): CronJobConfig {
		if (saved === undefined) return { ...base };
		return {
			id: base.id,
			title: this.nonEmptyString(saved.title, base.title),
			description: this.nonEmptyString(saved.description, base.description),
			prompt: this.nonEmptyString(saved.prompt, base.prompt),
			frequency: this.validCronFrequency(saved.frequency, base.frequency),
			time: this.validTime(saved.time, base.time),
			weekday: this.validCronWeekday(saved.weekday, base.weekday),
			outputFolder: this.nonEmptyString(saved.outputFolder, base.outputFolder),
			filePrefix: this.nonEmptyString(saved.filePrefix, base.filePrefix),
			configPath: this.nonEmptyString(saved.configPath, base.configPath),
			workingDirectory: typeof saved.workingDirectory === 'string' ? saved.workingDirectory : base.workingDirectory,
			enabled: typeof saved.enabled === 'boolean' ? saved.enabled : base.enabled,
			createdAt: typeof saved.createdAt === 'number' ? saved.createdAt : base.createdAt,
			updatedAt: typeof saved.updatedAt === 'number' ? saved.updatedAt : base.updatedAt,
		};
	}

	private nonEmptyString(value: unknown, fallback: string): string {
		return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
	}

	private validTime(value: unknown, fallback: string): string {
		return typeof value === 'string' && /^\d{2}:\d{2}$/.test(value) ? value : fallback;
	}

	private validCronFrequency(value: unknown, fallback: CronFrequency): CronFrequency {
		const values = Object.values(CRON_FREQUENCY) as CronFrequency[];
		return values.includes(value as CronFrequency) ? value as CronFrequency : fallback;
	}

	private validCronWeekday(value: unknown, fallback: CronWeekday): CronWeekday {
		const values = Object.values(CRON_WEEKDAY) as CronWeekday[];
		return values.includes(value as CronWeekday) ? value as CronWeekday : fallback;
	}

	/** Persists all plugin data to Obsidian storage and writes a vault-side backup. */
	private async saveData_(): Promise<void> {
		this.data.timerState = this.timerEngine.getState();
		this.data.tasks = this.taskManager.toJSON();
		this.data.archivedTasks = this.taskManager.getArchivedTasksRef();
		this.data.dispatchHistory = this.aiDispatcher.toJSON();
		await this.saveData(this.data);
		BackupService.write(this.app, this.data.settings.outputFolder, this.data);
	}
}
