/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard Welcome
 * Description: Shared types, interfaces, and default data for the plugin
 * Created: 2026-03-07
 * Last Modified: 2026-03-13
 */

/** A named category for grouping tasks in the board view. */
export interface TaskCategory {
	/** Unique identifier. */
	id: string;
	/** Display name. */
	name: string;
	/** Sort order. */
	order: number;
	/** Optional hex color for the category column accent. */
	color?: string;
	/** When true, this category cannot be deleted by the user. */
	isDefault?: boolean;
	/** When true, tasks in this category are cleared on day change. */
	dailyReset?: boolean;
}

/** A subtask within a parent task, supporting nested hierarchy. */
export interface SubTask {
	/** Unique identifier. */
	id: string;
	/** Display title. */
	title: string;
	/** Completion status. */
	status: 'pending' | 'completed';
	/** Optional nested subtasks. */
	subtasks?: SubTask[];
}

/** A task with timing, status, subtasks, and optional metadata. */
export interface Task {
	/** Unique identifier. */
	id: string;
	/** Display title. */
	title: string;
	/** Optional description. */
	description?: string;
	/** Planned duration in minutes. */
	durationMinutes: number;
	/** Current status. */
	status: 'pending' | 'active' | 'completed' | 'skipped';
	/** Sort order for display. */
	order: number;
	/** Creation timestamp (ms). */
	createdAt: number;
	/** When the task was started (ms). */
	startedAt?: number;
	/** When the task was completed (ms). */
	completedAt?: number;
	/** Actual end time when snapped to boundaries (ms). */
	actualEndTime?: number;
	/** Rollover minutes applied when starting. */
	rolloverApplied?: number;
	/** Optional subtasks. */
	subtasks?: SubTask[];
	/** Optional tags for filtering. */
	tags?: string[];
	/** Linked document paths. */
	linkedDocs?: string[];
	/** Image attachment paths. */
	images?: string[];
	/** Per-task working directory for AI CLI execution. */
	workingDirectory?: string;
	/** Actual duration when completed (minutes). */
	actualDurationMinutes?: number;
	/** AI delegation status if delegated. */
	delegationStatus?: 'dispatched' | 'completed' | 'failed';
	/** Feedback from AI delegation. */
	delegationFeedback?: string;
	/** AI dispatch records attached to this task. Archived alongside the task. */
	dispatchRecords?: DispatchHistoryEntry[];
	/** Category this task belongs to (uncategorized if absent). */
	categoryId?: string;
}

/** Reusable task template for quick creation. */
export interface TaskTemplate {
	/** Unique identifier. */
	id: string;
	/** Template name. */
	name: string;
	/** Default duration in minutes. */
	durationMinutes: number;
	/** Optional subtask structure. */
	subtasks?: SubTask[];
	/** Optional default tags. */
	tags?: string[];
}

/** Current state of the timer engine. */
export interface TimerState {
	/** ID of the task being timed, or null if idle. */
	currentTaskId: string | null;
	/** Start timestamp (ms), or null if not running. */
	startTime: number | null;
	/** End timestamp (ms), or null if not running. */
	endTime: number | null;
	/** Accumulated rollover minutes. */
	rolloverBalance: number;
	/** Base duration for the current session (minutes). */
	baseDurationMinutes: number;
	/** Whether the timer is actively counting. */
	isRunning: boolean;
	/** Whether the timer is paused. */
	isPaused: boolean;
	/** Remaining ms when paused, or null. */
	pausedRemaining: number | null;
	/** Number of completed pomodoro work sessions. */
	pomodoroCount: number;
	/** Whether currently on a pomodoro break. */
	isBreak: boolean;
}

/** A report source with folder path and filename pattern. */
export interface ReportSource {
	/** Unique identifier. */
	id: string;
	/** Display label. */
	label: string;
	/** Folder path relative to report base. */
	folder: string;
	/** Regex for matching filenames. */
	pattern: RegExp;
	/** Report frequency. */
	frequency: 'daily' | 'weekly';
}

/** Report source configuration (serializable, pattern as string). */
export interface ReportSourceConfig {
	/** Unique identifier. */
	id: string;
	/** Display label. */
	label: string;
	/** Folder path relative to report base. */
	folder: string;
	/** Regex pattern as string (compiled to RegExp at runtime). */
	patternStr: string;
	/** Report frequency. */
	frequency: 'daily' | 'weekly';
	/** Whether this source is enabled. */
	enabled: boolean;
}

/** Configuration for a dashboard module. */
export interface ModuleConfig {
	/** Unique identifier. */
	id: string;
	/** Display name. */
	name: string;
	/** Whether the module is enabled. */
	enabled: boolean;
	/** Sort order. */
	order: number;
	/** Whether the module is collapsed. */
	collapsed: boolean;
	/** Optional module-specific settings. */
	settings?: Record<string, unknown>;
}

/** Plugin-wide settings. */
export interface PluginSettings {
	/** Snap interval for clock-aligned timers (minutes). */
	snapIntervalMinutes: number;
	/** Dashboard module configurations. */
	modules: ModuleConfig[];
	/** Quick access document paths. */
	quickAccessPaths: string[];
	/** Open dashboard on Obsidian startup. */
	autoOpenOnStartup: boolean;
	/** Pin the dashboard tab. */
	autoPinTab: boolean;
	/** Tag-to-hex-color mapping. */
	tagColors: Record<string, string>;
	/** Saved task templates. */
	templates: TaskTemplate[];
	/** Master audio toggle. */
	audioEnabled: boolean;
	/** Play sound on timer complete. */
	audioOnComplete: boolean;
	/** Play sound when timer goes negative. */
	audioOnNegative: boolean;
	/** Timer mode: clock-aligned or pomodoro. */
	timerMode: 'clock-aligned' | 'pomodoro';
	/** Pomodoro work session length (minutes). */
	pomodoroWorkMinutes: number;
	/** Pomodoro short break length (minutes). */
	pomodoroBreakMinutes: number;
	/** Pomodoro long break length (minutes). */
	pomodoroLongBreakMinutes: number;
	/** Work sessions before a long break. */
	pomodoroLongBreakInterval: number;
	/** Whether onboarding has been shown. */
	hasSeenOnboarding: boolean;
	/** Ordered module IDs. */
	moduleOrder: string[];
	/** Folder for daily notes. */
	dailyNotesFolder: string;
	/** Heatmap color scheme name. */
	heatmapColorScheme: string;
	/** Heatmap base color (hex). */
	heatmapColor: string;
	/** Task tree branch color (hex). */
	branchColor: string;
	/** Tag used for heatmap filtering. */
	heatmapTagFilter: string;
	/** Base path for report scanning. */
	reportBasePath: string;
	/** Report source configurations. */
	reportSources: ReportSourceConfig[];
	/** AI tool integration. */
	aiTool: 'cursor' | 'claude-code' | 'none';
	/** Path to AI tool executable. */
	aiToolPath: string;
	/** AI auto-organize tasks. */
	aiAutoOrganize: boolean;
	/** AI auto-order tasks. */
	aiAutoOrder: boolean;
	/** AI delegation feature. */
	aiDelegation: boolean;
	/** Skip interactive permission prompts when dispatching to AI CLI tools. */
	aiSkipPermissions: boolean;
	/** Preferred terminal app for dispatch take-over. */
	terminalApp: 'ghostty' | 'terminal';
	/** Allow filtering by multiple tags. */
	enableMultiTagFilter: boolean;
	/** Allow image attachments on tasks. */
	enableImageAttachments: boolean;
	/** Show confirmation dialogs for destructive actions. */
	showConfirmDialogs: boolean;
	/** Days after which completed tasks auto-archive (0 = disabled). */
	autoArchiveDays: number;
	/** Base folder for all plugin-generated output (prompts, attachments, documents). */
	outputFolder: string;
	/** Task category definitions for the board view. */
	taskCategories: TaskCategory[];
	/** Currently focused category in the board view, or null for all. */
	activeCategoryId: string | null;
	/** Whether the entire modules section is collapsed. */
	modulesCollapsed: boolean;
}

/** Possible statuses for a dispatch record. */
export type DispatchStatus =
	| 'running'
	| 'completed'
	| 'failed'
	| 'plan-pending'
	| 'plan-ready'
	| 'plan-approved'
	| 'plan-rejected';

/** Serializable snapshot of an AI dispatch for persistence. */
export interface DispatchHistoryEntry {
	id: string;
	action: string;
	label: string;
	taskId: string;
	taskTitle: string;
	tool: string;
	status: DispatchStatus;
	startTime: number;
	endTime?: number;
	error?: string;
	vaultPath: string;
	/** Captured plan text from a plan-phase dispatch. */
	planText?: string;
	/** Links an execution dispatch back to its originating plan record. */
	parentPlanId?: string;
}

/** Root plugin data persisted to disk. */
export interface PluginData {
	/** Plugin settings. */
	settings: PluginSettings;
	/** Active tasks. */
	tasks: Task[];
	/** Archived tasks. */
	archivedTasks: Task[];
	/** Current timer state. */
	timerState: TimerState;
	/** Last dashboard open timestamp (ms). */
	lastDashboardOpenedAt: number;
	/** Persisted AI dispatch history. */
	dispatchHistory: DispatchHistoryEntry[];
}

/** Default timer state when no session is active. */
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

/** Default plugin settings. */
export const DEFAULT_SETTINGS: PluginSettings = {
	snapIntervalMinutes: 30,
	modules: [
		{ id: 'quick-access', name: 'Quick Access Documents', enabled: true, order: 0, collapsed: false },
		{ id: 'daily-reports', name: 'Daily Reports', enabled: true, order: 1, collapsed: false },
		{ id: 'weekly-reports', name: 'Weekly Reports', enabled: true, order: 2, collapsed: false },
		{ id: 'last-opened', name: 'Last Opened Documents', enabled: true, order: 3, collapsed: false },
		{ id: 'ai-dispatches', name: 'AI Dispatches', enabled: true, order: 4, collapsed: false },
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
	reportSources: [
		{ id: 'interview-prep', label: 'Interview Prep', folder: 'Daily Interview Prep', patternStr: '^(.+)\\.(md|html)$', frequency: 'daily', enabled: true },
		{ id: 'daily-trends', label: 'Daily Trends', folder: 'Review Daily Trends', patternStr: '^Daily_Trends_Report_(\\d{4}-\\d{2}-\\d{2})\\.(md|html)$', frequency: 'daily', enabled: true },
		{ id: 'local-leads', label: 'Local Leads', folder: 'Daily Local Leads', patternStr: '^(.+)\\.(md|html)$', frequency: 'daily', enabled: true },
		{ id: 'app-store-intel', label: 'App Store Intel', folder: 'Daily App Store Intel', patternStr: '^(.+)\\.(md|html)$', frequency: 'daily', enabled: true },
		{ id: 'weekly-jobs', label: 'Jobs Report', folder: 'Weekly Jobs Reports', patternStr: '^(.+)\\.(md|html)$', frequency: 'weekly', enabled: true },
		{ id: 'competitor-watch', label: 'Competitor Watch', folder: 'Weekly Competitor Watch', patternStr: '^(.+)\\.(md|html)$', frequency: 'weekly', enabled: true },
	],
	aiTool: 'none',
	aiToolPath: '',
	aiAutoOrganize: false,
	aiAutoOrder: false,
	aiDelegation: false,
	aiSkipPermissions: false,
	terminalApp: 'ghostty',
	enableMultiTagFilter: true,
	enableImageAttachments: true,
	showConfirmDialogs: true,
	autoArchiveDays: 0,
	outputFolder: '_VaultWelcome',
	taskCategories: [
		{ id: 'default-daily', name: 'Daily Tasks', order: 0, isDefault: true, dailyReset: true },
		{ id: 'default-general', name: 'General', order: 1, isDefault: true },
	],
	activeCategoryId: null,
	modulesCollapsed: false,
};

/** Default plugin data for new installs. */
export const DEFAULT_DATA: PluginData = {
	settings: DEFAULT_SETTINGS,
	tasks: [],
	archivedTasks: [],
	timerState: DEFAULT_TIMER_STATE,
	lastDashboardOpenedAt: 0,
	dispatchHistory: [],
};

/** Supported image file extensions for task attachments. */
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'] as const;

/** Returns true when a file extension (without dot) is an image type. */
export const isImageExtension = (ext: string): boolean =>
	(IMAGE_EXTENSIONS as readonly string[]).includes(ext.toLowerCase());

/** Obsidian view type identifier for the welcome dashboard. */
export const VIEW_TYPE_WELCOME = 'vault-welcome-view';

/** Obsidian view type identifier for the mini timer pop-out. */
export const VIEW_TYPE_MINI_TIMER = 'vault-welcome-mini-timer';

/** Callback invoked on each timer tick with remaining ms and negative flag. */
export type TimerEventCallback = (remaining: number, isNegative: boolean) => void;

/** Callback invoked when a timer completes with task ID and rollover minutes. */
export type TimerCompleteCallback = (taskId: string, rollover: number) => void;
