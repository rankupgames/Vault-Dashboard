/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard Welcome
 * Description: Shared types, interfaces, and default data for the plugin
 * Created: 2026-03-07
 * Edited By: Miguel A. Lopez
 * Last Modified: 2026-03-08
 */

export interface SubTask {
	id: string;
	title: string;
	status: 'pending' | 'completed';
	subtasks?: SubTask[];
}

export interface Task {
	id: string;
	title: string;
	description?: string;
	durationMinutes: number;
	status: 'pending' | 'active' | 'completed' | 'skipped';
	order: number;
	createdAt: number;
	startedAt?: number;
	completedAt?: number;
	actualEndTime?: number;
	rolloverApplied?: number;
	subtasks?: SubTask[];
	tags?: string[];
	linkedDocs?: string[];
	images?: string[];
	actualDurationMinutes?: number;
	delegationStatus?: 'dispatched' | 'completed' | 'failed';
	delegationFeedback?: string;
}

export interface TaskTemplate {
	id: string;
	name: string;
	durationMinutes: number;
	subtasks?: SubTask[];
	tags?: string[];
}

export interface TimerState {
	currentTaskId: string | null;
	startTime: number | null;
	endTime: number | null;
	rolloverBalance: number;
	baseDurationMinutes: number;
	isRunning: boolean;
	isPaused: boolean;
	pausedRemaining: number | null;
	pomodoroCount: number;
	isBreak: boolean;
}

export interface ReportSource {
	id: string;
	label: string;
	folder: string;
	pattern: RegExp;
	frequency: 'daily' | 'weekly';
}

export interface ModuleConfig {
	id: string;
	name: string;
	enabled: boolean;
	order: number;
	collapsed: boolean;
	settings?: Record<string, unknown>;
}

export interface PluginSettings {
	snapIntervalMinutes: number;
	modules: ModuleConfig[];
	quickAccessPaths: string[];
	autoOpenOnStartup: boolean;
	autoPinTab: boolean;
	tagColors: Record<string, string>;
	templates: TaskTemplate[];
	audioEnabled: boolean;
	audioOnComplete: boolean;
	audioOnNegative: boolean;
	timerMode: 'clock-aligned' | 'pomodoro';
	pomodoroWorkMinutes: number;
	pomodoroBreakMinutes: number;
	pomodoroLongBreakMinutes: number;
	pomodoroLongBreakInterval: number;
	hasSeenOnboarding: boolean;
	moduleOrder: string[];
	dailyNotesFolder: string;
	heatmapColorScheme: string;
	heatmapColor: string;
	branchColor: string;
	heatmapTagFilter: string;
	reportBasePath: string;
	aiTool: 'cursor' | 'claude-code' | 'none';
	aiToolPath: string;
	aiAutoOrganize: boolean;
	aiAutoOrder: boolean;
	aiAutoScheduler: boolean;
	aiDelegation: boolean;
	enableMultiTagFilter: boolean;
	enableImageAttachments: boolean;
	showConfirmDialogs: boolean;
	autoArchiveDays: number;
}

export interface PluginData {
	settings: PluginSettings;
	tasks: Task[];
	archivedTasks: Task[];
	timerState: TimerState;
	lastDashboardOpenedAt: number;
}

export const DEFAULT_TIMER_STATE: TimerState = {
	currentTaskId: null,
	startTime: null,
	endTime: null,
	rolloverBalance: 0,
	baseDurationMinutes: 0,
	isRunning: false,
	isPaused: false,
	pausedRemaining: null,
	pomodoroCount: 0,
	isBreak: false,
};

export const DEFAULT_SETTINGS: PluginSettings = {
	snapIntervalMinutes: 30,
	modules: [
		{ id: 'quick-access', name: 'Quick Access Documents', enabled: true, order: 0, collapsed: false },
		{ id: 'daily-reports', name: 'Daily Reports', enabled: true, order: 1, collapsed: false },
		{ id: 'weekly-reports', name: 'Weekly Reports', enabled: true, order: 2, collapsed: false },
		{ id: 'last-opened', name: 'Last Opened Documents', enabled: true, order: 3, collapsed: false },
	],
	quickAccessPaths: [],
	autoOpenOnStartup: true,
	autoPinTab: true,
	tagColors: {},
	templates: [],
	audioEnabled: false,
	audioOnComplete: true,
	audioOnNegative: true,
	timerMode: 'clock-aligned',
	pomodoroWorkMinutes: 25,
	pomodoroBreakMinutes: 5,
	pomodoroLongBreakMinutes: 15,
	pomodoroLongBreakInterval: 4,
	hasSeenOnboarding: false,
	moduleOrder: [],
	dailyNotesFolder: '_DailyNotes',
	heatmapColorScheme: 'green',
	heatmapColor: '#39d353',
	branchColor: '#4ea8de',
	heatmapTagFilter: 'Task',
	reportBasePath: 'WorkspaceVault/Personal/ClaudeCRON',
	aiTool: 'none',
	aiToolPath: '',
	aiAutoOrganize: false,
	aiAutoOrder: false,
	aiAutoScheduler: false,
	aiDelegation: false,
	enableMultiTagFilter: true,
	enableImageAttachments: true,
	showConfirmDialogs: true,
	autoArchiveDays: 0,
};

export const DEFAULT_DATA: PluginData = {
	settings: DEFAULT_SETTINGS,
	tasks: [],
	archivedTasks: [],
	timerState: DEFAULT_TIMER_STATE,
	lastDashboardOpenedAt: 0,
};

export const VIEW_TYPE_WELCOME = 'vault-welcome-view';

export type TimerEventCallback = (remaining: number, isNegative: boolean) => void;
export type TimerCompleteCallback = (taskId: string, rollover: number) => void;
