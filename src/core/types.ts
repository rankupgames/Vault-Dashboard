/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard
 * Description: Shared types, interfaces, and default data for the plugin
 * Created: 2026-03-07
 * Last Modified: 2026-05-13
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
	/** Display name for the active ghost task, or null when running a real task. */
	ghostTaskName: string | null;
	/** When true, the next resume should re-compute clock-aligned end time. */
	needsRealign: boolean;
	/** Task ID that was suspended when a ghost task interrupted it. */
	suspendedTaskId: string | null;
	/** Base duration of the suspended task (minutes) for restarting. */
	suspendedBaseDuration: number;
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

export const CRON_FREQUENCY = {
	MANUAL: 'manual',
	DAILY: 'daily',
	WEEKLY: 'weekly',
} as const;

export type CronFrequency = (typeof CRON_FREQUENCY)[keyof typeof CRON_FREQUENCY];

export const CRON_WEEKDAY = {
	SUNDAY: 'sunday',
	MONDAY: 'monday',
	TUESDAY: 'tuesday',
	WEDNESDAY: 'wednesday',
	THURSDAY: 'thursday',
	FRIDAY: 'friday',
	SATURDAY: 'saturday',
} as const;

export type CronWeekday = (typeof CRON_WEEKDAY)[keyof typeof CRON_WEEKDAY];

/** Dashboard-managed scheduled report job backed by a Vault config note and launchd. */
export interface CronJobConfig {
	/** Stable unique identifier. */
	id: string;
	/** Display title. */
	title: string;
	/** Short description shown in the dashboard and config note. */
	description: string;
	/** Prompt sent to the AI CLI runner. */
	prompt: string;
	/** Manual, daily, or weekly schedule. */
	frequency: CronFrequency;
	/** Local time in HH:mm, 24-hour format. */
	time: string;
	/** Weekly run day; ignored for daily/manual jobs. */
	weekday: CronWeekday;
	/** Vault folder where generated reports should be written. */
	outputFolder: string;
	/** Filename prefix for generated report matching. */
	filePrefix: string;
	/** Vault markdown note that stores the runnable cron prompt/config. */
	configPath: string;
	/** Optional absolute working directory for the AI CLI; blank means repo root. */
	workingDirectory: string;
	/** Whether launchd scheduling is enabled. */
	enabled: boolean;
	/** Creation timestamp in ms. */
	createdAt: number;
	/** Last update timestamp in ms. */
	updatedAt: number;
}

/** User-configurable paths and defaults for the read-only Gmail digest tool. */
export interface GmailDigestSettings {
	/** Optional Python executable. Blank resolves to the tool's local virtual environment. */
	pythonPath: string;
	/** Optional digest script path. Blank resolves relative to the repo beside the Vault. */
	scriptPath: string;
	/** Optional command working directory. Blank resolves to the repo beside the Vault. */
	workingDirectory: string;
	/** Gmail search query used by manual reviews and the scheduled digest. */
	query: string;
	/** Maximum thread count to sync before writing a digest. */
	limit: number;
	/** Digest date passed to the tool; "today" uses the local date. */
	digestDate: string;
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
	/** Dashboard-managed cron jobs. */
	cronJobs: CronJobConfig[];
	/** Read-only Gmail digest command settings. */
	gmailDigest: GmailDigestSettings;
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
	/** IDE to open the workspace in after a dispatch completes. */
	postDispatchIDE: 'cursor' | 'vscode' | 'none';
	/** User-defined tags that persist regardless of task usage. */
	customTags: string[];
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
	/** Last known screen position of the mini timer popout (null = use default). */
	miniTimerPosition: { x: number; y: number } | null;
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
	ghostTaskName: null,
	needsRealign: false,
	suspendedTaskId: null,
	suspendedBaseDuration: 0,
};

const DEFAULT_DAILY_REPORT_PROMPT = `Generate one consolidated daily report for Miguel and Rank Up Games.

Use today's local date. Save a markdown file named Daily_Report_YYYY-MM-DD.md in WorkspaceVault/Personal/ClaudeCRON/Daily Report/.

Required sections:
- Executive Summary: the 5 highest-value signals from today.
- Gaming and Software Trends: PC, console, mobile, AI/dev tools, .NET, Unity, web, cloud, and business/funding movements.
- App Store and Product Intel: mobile FPS, idle/incremental, monetization, ASO, keywords, competitor behavior, and launch implications for WIA and Crystal Mines.
- Local Leads and Business Development: Winter Haven, Polk County, Orlando, Tampa, and I-4 corridor opportunities, events, grants, partnerships, and outreach targets.
- Interview Prep: 4 senior-level prompts covering .NET/C#, Unity/game systems, system design, and leadership.
- Action Plan: 5 concrete next actions with owner, why it matters, and suggested timing.

Rules:
- Use real sources and include links.
- Prioritize information that can create revenue, improve launch strategy, improve job pipeline outcomes, or reduce execution risk.
- Do not create HTML, DOCX, or CSS. Markdown only.`;

const DEFAULT_WEEKLY_REPORT_PROMPT = `Generate one consolidated weekly report for Miguel and Rank Up Games.

Use today's local date. Save a markdown file named Weekly_Report_YYYY-MM-DD.md in WorkspaceVault/Personal/ClaudeCRON/Weekly Report/.

Required sections:
- Executive Summary: the 7 most important weekly opportunities or risks.
- Job Pipeline: senior .NET/C#, Unity, full-stack, backend, technical lead, and game networking roles worth actioning.
- Recruiter and Hiring Manager Angles: who to follow up with, why, and suggested message angle.
- Competitive Watch: WIA, Crystal Mines, Project Uplink, mobile FPS, idle/incremental, game backend tools, and competitor positioning.
- Market and Funding Signals: grants, accelerators, business development, and client-service opportunities.
- Action Plan: top 10 weekly actions sorted by expected value.

Rules:
- Use real sources and include links.
- Prioritize leads that match Miguel's skillset or Rank Up Games' near-term business goals.
- Do not create HTML, DOCX, or CSS. Markdown only.`;

/** Default dashboard-managed cron jobs. */
export const DEFAULT_CRON_JOBS: CronJobConfig[] = [
	{
		id: 'daily-report',
		title: 'Daily Report',
		description: 'Consolidated daily trends, app store intel, local leads, and interview prep.',
		prompt: DEFAULT_DAILY_REPORT_PROMPT,
		frequency: CRON_FREQUENCY.DAILY,
		time: '08:00',
		weekday: CRON_WEEKDAY.WEDNESDAY,
		outputFolder: 'WorkspaceVault/Personal/ClaudeCRON/Daily Report',
		filePrefix: 'Daily_Report',
		configPath: 'WorkspaceVault/Personal/ClaudeCRON/Configs/Daily_Report.md',
		workingDirectory: '',
		enabled: true,
		createdAt: 0,
		updatedAt: 0,
	},
	{
		id: 'weekly-report',
		title: 'Weekly Report',
		description: 'Consolidated weekly jobs pipeline and competitor watch.',
		prompt: DEFAULT_WEEKLY_REPORT_PROMPT,
		frequency: CRON_FREQUENCY.WEEKLY,
		time: '08:00',
		weekday: CRON_WEEKDAY.WEDNESDAY,
		outputFolder: 'WorkspaceVault/Personal/ClaudeCRON/Weekly Report',
		filePrefix: 'Weekly_Report',
		configPath: 'WorkspaceVault/Personal/ClaudeCRON/Configs/Weekly_Report.md',
		workingDirectory: '',
		enabled: true,
		createdAt: 0,
		updatedAt: 0,
	},
];

/** Default read-only Gmail digest command settings. */
export const DEFAULT_GMAIL_DIGEST_SETTINGS: GmailDigestSettings = {
	pythonPath: '',
	scriptPath: '',
	workingDirectory: '',
	query: 'in:anywhere newer_than:7d',
	limit: 500,
	digestDate: 'today',
};

/** Default plugin settings. */
export const DEFAULT_SETTINGS: PluginSettings = {
	snapIntervalMinutes: 30,
	modules: [
		{ id: 'quick-access', name: 'Quick Access Documents', enabled: true, order: 0, collapsed: false },
		{ id: 'latest-markdown', name: 'Latest Markdown Files', enabled: true, order: 1, collapsed: false },
		{ id: 'daily-reports', name: 'Daily Reports', enabled: true, order: 2, collapsed: false },
		{ id: 'gmail-intelligence', name: 'Gmail Intelligence', enabled: true, order: 3, collapsed: false },
		{ id: 'crons', name: 'Crons', enabled: true, order: 4, collapsed: false },
		{ id: 'weekly-reports', name: 'Weekly Reports', enabled: true, order: 5, collapsed: false },
		{ id: 'last-opened', name: 'Last Opened Documents', enabled: true, order: 6, collapsed: false },
		{ id: 'ai-dispatches', name: 'AI Dispatches', enabled: true, order: 7, collapsed: false },
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
		{ id: 'daily-report', label: 'Daily Report', folder: 'Daily Report', patternStr: '^Daily_Report_(\\d{4}-\\d{2}-\\d{2})\\.(md|html)$', frequency: 'daily', enabled: true },
		{ id: 'weekly-report', label: 'Weekly Report', folder: 'Weekly Report', patternStr: '^Weekly_Report_(\\d{4}-\\d{2}-\\d{2})\\.(md|html)$', frequency: 'weekly', enabled: true },
	],
	cronJobs: DEFAULT_CRON_JOBS,
	gmailDigest: { ...DEFAULT_GMAIL_DIGEST_SETTINGS },
	aiTool: 'none',
	aiToolPath: '',
	aiAutoOrganize: false,
	aiAutoOrder: false,
	aiDelegation: false,
	aiSkipPermissions: false,
	terminalApp: 'ghostty',
	postDispatchIDE: 'cursor',
	customTags: [],
	enableMultiTagFilter: true,
	enableImageAttachments: true,
	showConfirmDialogs: true,
	autoArchiveDays: 0,
	outputFolder: '_VaultDashboard',
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
	miniTimerPosition: null,
};

/** Supported image file extensions for task attachments. */
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'] as const;

/** Returns true when a file extension (without dot) is an image type. */
export const isImageExtension = (ext: string): boolean =>
	(IMAGE_EXTENSIONS as readonly string[]).includes(ext.toLowerCase());

/** Obsidian view type identifier for the welcome dashboard. */
export const VIEW_TYPE_WELCOME = 'vault-dashboard-view';

/** Obsidian view type identifier for the mini timer pop-out. */
export const VIEW_TYPE_MINI_TIMER = 'vault-dashboard-mini-timer';

/** Callback invoked on each timer tick with remaining ms and negative flag. */
export type TimerEventCallback = (remaining: number, isNegative: boolean) => void;

/** Callback invoked when a timer completes with task ID and rollover minutes. */
export type TimerCompleteCallback = (taskId: string, rollover: number) => void;
