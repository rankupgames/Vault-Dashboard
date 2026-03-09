# Vault Welcome Dashboard

**A productivity-first home screen for [Obsidian](https://obsidian.md).** Replaces the default empty tab with an interactive dashboard built around a clock-aligned rollover timer, chunked task management with git-tree subtask visualization, and a modular widget system -- all theme-aware and responsive.

## Why This Exists

Most task timers treat time as a raw countdown: start 30 minutes, finish whenever. That approach ignores the fact that real schedules are built around clock boundaries -- meetings start on the hour, focus blocks end at :30. **Vault Welcome** snaps every timer to the next clean time boundary so your day stays structured without manual math. Finish early and the leftover minutes bank forward; go over and the debt rolls into the next task. The result is a self-correcting schedule that keeps you on track across an entire work session.

The dashboard is designed to be the first thing you see when you open your vault: your tasks, your timer, your recent documents, and your productivity history -- all in one view.

## Screenshots

> Coming soon -- the plugin adapts to any Obsidian theme (light, dark, or custom).

## Features

### Clock-Aligned Rollover Timer
- Start a task and the timer snaps to the next clean time boundary (configurable: 15/30/60 min intervals)
- Example: Start a 30-min task at 6:12 -- timer ends at 7:00, not 6:42
- **Positive rollover (time banking)**: Finish early and the remaining time carries to the next task
- **Negative rollover (time debt)**: Go over and the debt is subtracted from the next task's allotment
- Timer persists across Obsidian restarts

### Pomodoro Mode
- Toggle between clock-aligned and classic Pomodoro (work/break intervals)
- Configurable work, short break, and long break durations
- Session counter dots and auto-cycling between work and break phases

### Chunked Task Management
- Add tasks with title, description, and duration
- Each task is started individually with its own clock-aligned timer
- Drag-and-drop reordering with git-tree visual layout
- Rollover balance flows from one task to the next
- Task state stored locally in `data.json`

### Sub-Task Tree (Git-Tree View)
- Nest subtasks up to 4 levels deep under any parent task
- Visual branch and connector layout with depth-colored lines (customizable branch color)
- Collapsible branches, inline completion toggling, and drag-to-reorder

### Task Tags and Templates
- Freeform color-coded labels for filtering and grouping (e.g. "deep work", "standup")
- **Multi-tag filter**: Select multiple tags to narrow the task list at once (toggle in settings)
- Save and reuse task templates (title, duration, subtasks, tags) for recurring work

### Linked Documents and Image Attachments
- Attach vault documents to any task for context, notes, or specs
- **Link existing**: Fuzzy-search file picker to attach any markdown file in your vault
- **Create new**: Type a path (e.g. `Notes/Sprint 4/Design Doc`) to create and link a file in one step -- folders are auto-created
- Linked docs show as a badge with count on the task row; click to open a popover with direct links
- **Image attachments**: Attach images to tasks via a filtered file picker (toggle in settings)

### Task Import from Notes
- Scan any note's checklists and selectively import items as dashboard tasks
- File picker with preview and selective import modal

### Archive and Auto-Archive
- Completed and skipped tasks move to the archive
- **Archive detail modal**: Click any archived task to view full details, then restore or permanently delete
- **Auto-archive**: Automatically archive stale tasks after a configurable number of days (0 = disabled)
- Archive displayed as a card grid with tag pills and timestamps

### Confirmation Dialogs
- Destructive actions (reset all, delete archived, remove task, start over active timer) prompt a confirmation modal
- **Start confirmation**: Starting a task while another is running offers Start Now, Queue Next, or Cancel
- Dialogs can be globally disabled in settings

### AI Integration
- Optional integration with **Cursor CLI** or **Claude Code CLI** for AI-assisted task management
- **AI auto-organize**: Suggest tags and position when creating a task
- **AI auto-order**: Reorder pending tasks by priority from the timeline header
- **AI auto-scheduler**: Suggest durations for tasks without estimates
- **AI delegation**: Dispatch a task (with linked docs and images as context) to a CLI tool for execution
- Writes a temporary prompt file (`_vault-welcome-ai-prompt.md`) and invokes the configured CLI
- All AI features are individually toggleable; set to `none` to disable entirely

### Heatmap Tracker
- GitHub-style contribution grid built from completed tasks and daily note task tags
- Current and longest streak counters
- Weekly/monthly/all-time summary stats (tasks completed, total time, avg session)
- Configurable color schemes (green, red, blue, purple)

### Modular Widget System
The left column is a container of independent widget panels:

| Module | Description |
|--------|-------------|
| **Interview Prep** | Daily interview prep reports |
| **Daily Trends** | Daily trend reports |
| **Local Leads** | Daily local lead reports |
| **App Store Intel** | Daily app store intelligence reports |
| **Jobs Report** | Weekly job market reports |
| **Competitor Watch** | Weekly competitor analysis reports |
| **Last Opened Documents** | Shows recently opened vault files |
| **Quick Access Documents** | User-pinned file shortcuts (also available via file context menu) |
| **Heatmap Tracker** | Contribution grid with streak and stat counters |

Report modules are powered by a configurable `reportBasePath` setting. Each module is collapsible, independently scrollable, and drag-to-reorderable.

### Custom Module API
Other Obsidian plugins can register their own widget panels:

```typescript
const vw = (this.app as any).plugins.plugins['vault-welcome'];
vw.registerModule({
  id: 'my-widget',
  name: 'My Widget',
  renderContent(el: HTMLElement) {
    el.createDiv({ text: 'Hello from my widget!' });
  },
  destroy() { /* cleanup */ },
});

// To remove:
vw.unregisterModule('my-widget');
```

The `ModuleRenderer` interface:

```typescript
interface ModuleRenderer {
  readonly id: string;
  readonly name: string;
  readonly showRefresh?: boolean;
  renderContent(el: HTMLElement): void;
  renderHeaderActions?(actionsEl: HTMLElement): void;
  destroy?(): void;
}
```

### Additional UX
- **Pinned first tab** -- Dashboard auto-pins as the leftmost tab and survives layout changes
- **Audio notifications** -- Synthesized tones on timer completion and overtime
- **Keyboard shortcuts** -- Obsidian commands for start, pause, complete, skip, and add-task
- **Dashboard deep link** -- `obsidian://vault-welcome` protocol handler
- **Undo/redo** -- Snapshot-based undo stack for task mutations
- **Export analytics** -- CSV export or append summary to today's daily note
- **Onboarding walkthrough** -- Inline 4-step guide on first launch
- **Theme-aware** -- All colors use Obsidian CSS variables, adapts to any theme
- **Responsive layout** -- 2-column desktop grid collapses to single-column on mobile (<800px)

## Timer Mechanics

### Clock-Aligned Snapping

```
alignedEnd = ceil((now + effectiveDuration) / snapInterval) * snapInterval
effectiveDuration = baseDuration + rolloverBalance
```

Start at 6:12, 30 min task, snap = 30 min:
- Raw end: 6:42
- Aligned to next :00/:30 boundary: 7:00
- Actual countdown: 48 minutes

### Rollover

- Complete at 6:50 (end was 7:00): `+10 min` banked
- Next task: 30 min base + 10 rollover = 40 min effective, snapped to boundary
- Go past 7:00 by 5 min: `-5 min` debt
- Next task: 30 min base - 5 debt = 25 min effective, snapped to boundary

## Architecture

```
src/
  main.ts                  -- Plugin lifecycle, commands, ribbon, pinned tab, deep link, module API
  types.ts                 -- Shared interfaces and defaults
  WelcomeView.ts           -- Main ItemView rendering the dashboard layout
  TimerEngine.ts           -- Clock-aligned countdown with rollover + pomodoro mode
  TaskManager.ts           -- Task CRUD, ordering, archiving, tags, templates, undo/redo
  UndoManager.ts           -- Snapshot-based undo/redo stack for task mutations
  AudioService.ts          -- Web Audio API tone generator for notifications
  ModuleContainer.ts       -- Widget registry, grid renderer, drag-and-drop reorder
  SettingsTab.ts           -- Plugin settings UI (general, timer, audio, heatmap, AI, modules)
  ColorUtils.ts            -- Hex/HSL conversion, heatmap and branch shade generators
  Tooltip.ts               -- Custom tooltip, overflow detection, shared tag pill renderer
  ReportScanner.ts         -- Scans report folders, detects new reports since last open
  DocumentTracker.ts       -- Recent files and quick-access path resolution
  components/
    TimerSection.ts        -- Timer circle UI, SVG ring, controls, pomodoro dots
    HeatmapBar.ts          -- Contribution heatmap with streak counter and summary stats
    TaskTimeline.ts        -- Task list with git-tree, tag filter, archive, export, undo/redo
    SubtaskTree.ts         -- Subtask branch rendering with collapse and completion
    ModuleCard.ts          -- Card wrapper for module renderers with drag handle
    OnboardingOverlay.ts   -- 4-step inline walkthrough for first-run
  modals/
    TaskModal.ts           -- Add/edit task modal with tags, templates, subtasks, linked docs
    ImportModal.ts         -- Note checklist scanner with preview and selective import
    FileSuggestModal.ts    -- Fuzzy vault file picker for document and image linking
    ArchiveDetailModal.ts  -- Archived task detail view with restore and delete actions
    ConfirmModal.ts        -- Reusable confirmation modal for destructive actions
    ConfirmStartModal.ts   -- Start-while-active prompt (Start Now / Queue Next / Cancel)
  modules/
    ReportModule.ts        -- Sectioned report listing with six configurable sources
    DocumentModule.ts      -- Last opened and quick access document panels
  services/
    AnalyticsExporter.ts   -- CSV and daily note export
    TaskImporter.ts        -- Scan note checklists for importable tasks
    AIDispatcher.ts        -- AI context assembler and CLI dispatcher (Cursor / Claude Code)
  styles/
    root.css               -- CSS variables, grid layout, column structure
    timer.css              -- Timer circle, ring, display, controls
    heatmap.css            -- Heatmap grid, cells, legend, color scales, streaks, stats
    tasks.css              -- Task rows, actions, tags, archive grid, export, linked docs
    git-tree.css           -- Trunk, nodes, dots, branches, depth colors
    subtasks.css           -- Subtask rows, inline forms, editable text
    modules.css            -- Module card, header, collapse, refresh
    reports.css            -- Report sections, lists, new-report indicators
    documents.css          -- Document list, links, quick access toolbar
    modal.css              -- Task modal, confirmation dialogs, archive detail
    drag-drop.css          -- Drag handles, indicators, dragging state
    tooltip.css            -- Custom tooltip layout
    responsive.css         -- Media queries for mobile (<800px)
```

### Data Flow

```
TimerEngine <--> data.json <--> TaskManager
                    ^
WelcomeView --------+-------> ModuleContainer --> [modules]
```

## Data Storage

All persistent state lives in `data.json` (managed by Obsidian's plugin data API):

| Key | Contents |
|-----|----------|
| `settings.snapIntervalMinutes` | Clock snap interval (15, 30, or 60) |
| `settings.modules[]` | Module enable/order/collapse state |
| `settings.quickAccessPaths[]` | Pinned document paths |
| `settings.tagColors` | Map of tag name to hex color |
| `settings.templates[]` | Saved task templates (name, duration, subtasks, tags) |
| `settings.audioEnabled` | Master toggle for audio notifications |
| `settings.timerMode` | `'clock-aligned'` or `'pomodoro'` |
| `settings.pomodoroWorkMinutes` | Pomodoro work interval (default 25) |
| `settings.pomodoroBreakMinutes` | Pomodoro short break (default 5) |
| `settings.pomodoroLongBreakMinutes` | Pomodoro long break (default 15) |
| `settings.pomodoroLongBreakInterval` | Sessions before long break (default 4) |
| `settings.hasSeenOnboarding` | Whether the user dismissed the first-run walkthrough |
| `settings.moduleOrder[]` | Persisted module panel ordering |
| `settings.aiTool` | AI CLI tool: `'cursor'`, `'claude-code'`, or `'none'` |
| `settings.aiToolPath` | Custom CLI path override |
| `settings.aiAutoOrganize` | AI tag/position suggestions in task modal |
| `settings.aiAutoOrder` | AI task reordering in timeline |
| `settings.aiAutoScheduler` | AI duration suggestions |
| `settings.aiDelegation` | AI task delegation |
| `settings.enableMultiTagFilter` | Multi-select tag filtering |
| `settings.enableImageAttachments` | Image attachment support |
| `settings.showConfirmDialogs` | Confirmation dialogs for destructive actions |
| `settings.autoArchiveDays` | Auto-archive stale tasks after N days (0 = off) |
| `settings.reportBasePath` | Base vault folder for report sources |
| `settings.branchColor` | Custom git-tree branch color |
| `tasks[]` | Task list with status, duration, timestamps, tags, sub-tasks, linked docs, images |
| `archivedTasks[]` | Archived completed/skipped tasks |
| `timerState` | Current timer: running, paused, end time, rollover balance, pomodoro count |

## Requirements

- **Obsidian** 1.0.0 or later
- **Node.js** 18+ (for building from source)
- **Optional**: Templater plugin (for calendar day-note creation from template)

## Installation

### From Source

```bash
git clone https://github.com/dudetru25/vault-welcome.git
cd vault-welcome
npm install
npm run build
```

Then symlink or copy the built plugin into your vault:

```bash
ln -s /path/to/vault-welcome "/path/to/vault/.obsidian/plugins/vault-welcome"
```

Enable **Vault Welcome Dashboard** in Obsidian > Settings > Community Plugins.

### Development

```bash
npm run dev    # Watch mode -- rebuilds on save
```

Reload Obsidian with `Cmd+R` (macOS) or `Ctrl+R` (Windows/Linux) after changes.

## Roadmap

### Shipped

- Clock-aligned rollover timer with time banking and debt
- Pomodoro mode with configurable intervals
- Chunked task management with drag-and-drop reorder
- Sub-task tree with git-style branch visualization (4 levels, customizable branch color)
- Task tags, categories, and color-coded labels
- Multi-tag filter for narrowing the task list
- Task templates for recurring work
- Linked documents (fuzzy search + inline creation)
- Image attachments on tasks
- Task import from note checklists
- Archive detail modal with restore and permanent delete
- Auto-archive stale tasks after configurable days
- Confirmation dialogs for destructive actions (with start-while-active prompt)
- AI integration (Cursor CLI / Claude Code CLI) -- auto-organize, auto-order, auto-scheduler, delegation
- Heatmap tracker with streak and summary stats
- Modular widget system with drag-to-reorder
- Six report modules (Interview Prep, Daily Trends, Local Leads, App Store Intel, Jobs Report, Competitor Watch)
- Last opened and quick access document modules
- Audio notifications (completion chime, overtime warning)
- Keyboard shortcuts for all timer actions
- CSV and daily note analytics export
- Undo/redo for task mutations
- Dashboard deep link (`obsidian://vault-welcome`)
- Onboarding walkthrough for first-run
- Theme-aware design with Obsidian CSS variables
- Responsive layout (desktop 2-column, mobile single-column)
- Pinned first tab with layout persistence
- Custom module API for third-party plugins

### Planned

- **Day Timeline** -- Google Calendar-style time-block view (shelved while interaction model is refined)
- Screenshots and demo GIF for README
- Community plugin submission

## License

MIT -- see [LICENSE](LICENSE).

## Author

**Miguel A. Lopez** -- [Rank Up Games LLC](https://github.com/dudetru25)
