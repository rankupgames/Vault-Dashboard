# Vault Dashboard

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![Obsidian: 1.0+](https://img.shields.io/badge/Obsidian-1.0%2B-7c3aed)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)

**A productivity-first home screen for [Obsidian](https://obsidian.md).** Replaces the default empty tab with an interactive dashboard: clock-aligned rollover timer, chunked task management with git-tree subtasks, and a modular widget system. Theme-aware and responsive out of the box.

## Why This Exists

Most task timers treat time as a raw countdown: start 30 minutes, finish whenever. Real schedules don't work that way. Meetings start on the hour, focus blocks end at :30. **Vault Dashboard** snaps every timer to the next clean time boundary so your day stays structured without manual math. Finish early and the leftover minutes bank forward; go over and the debt rolls into the next task. It's a self-correcting schedule that keeps you on track across an entire work session.

Opens as the first thing you see in your vault: tasks, timer, recent documents, and productivity history in one view.

## Screenshots

![Vault Dashboard](assets/dashboard-screenshot.png)

Adapts to any Obsidian theme (light, dark, or custom).

---

## Features

### Clock-Aligned Rollover Timer

The timer snaps every task to the next clean time boundary (configurable: 15/30/60 min intervals) so your schedule stays grid-aligned without manual math.

- Start a 30-min task at 6:12 and the timer ends at 7:00 (not 6:42)
- **Time banking**: finish early and the leftover minutes carry to the next task
- **Time debt**: go over and the deficit is subtracted from the next task's allotment
- Timer persists across Obsidian restarts
- Alternative **Pomodoro mode** with configurable work/short-break/long-break intervals and session counter

### Task Management and Board View

Two view modes for organizing tasks: a linear **task timeline** and a **Kanban board** grouped by category.

- Add tasks with title, description, duration, tags, and attachments
- Each task gets its own clock-aligned timer; rollover flows from one to the next
- **Board view**: drag-and-drop columns by category with color-coded headers
- **List view**: git-tree visual layout with drag-to-reorder
- **Task categories**: user-defined groupings with custom colors; click a category to drill into list view
- **Task tags**: freeform color-coded labels for filtering (single or multi-tag); persists custom tags across sessions
- **Task templates**: save and reuse recurring task structures (title, duration, subtasks, tags)

### Sub-Task Tree

Nest subtasks up to 4 levels deep under any parent task with a visual branch-and-connector layout.

- Depth-colored connector lines (customizable branch color)
- Collapsible branches with inline completion toggling
- Drag-to-reorder within and across depth levels
- Add, rename, and remove subtasks inline

### AI Integration

Optional integration with **Cursor CLI** or **Claude Code CLI** for AI-assisted task management.

- **Auto-organize**: suggest tags and position when creating a task
- **Auto-order**: reorder pending tasks by priority from the timeline header
- **Delegation**: dispatch a task (with linked docs and images as context) to a CLI tool for execution
- **Plan approval**: AI generates a plan first; review, approve, or reject before execution
- **Per-task working directory**: each task can specify its own execution context for CLI dispatches
- **Dispatch module**: live status panel with elapsed time, terminal take-over, IDE launcher, and retry
- All AI features individually toggleable; set tool to `none` to disable entirely

### Mini Timer Pop-Out

A Spotify-style compact player that detaches into its own always-on-top window.

- SVG ring, countdown, task name marquee, and hover controls
- Stays live when the main Obsidian window is minimized (independent tick loop + visibility catch-up)
- Headless window chrome for a minimal footprint
- Remembers screen position across sessions

### Modular Widget System

The left column hosts independent widget panels, each collapsible, independently scrollable, and drag-to-reorderable.

- **Report modules**: daily and weekly report scanning powered by user-configured folder paths and filename patterns
- **Quick Access Documents**: user-pinned file shortcuts (also available via the file context menu)
- **Last Opened Documents**: recently opened vault files
- **AI Dispatches**: live dispatch status with plan preview, terminal take-over, and task completion
- **Heatmap Tracker**: GitHub-style contribution grid with streak counters and summary stats
- **Custom Module API**: third-party plugins can register their own widget panels (see [API.md](docs/API.md))

### Additional Features

- **Unified attachments**: single section combining documents and images with fuzzy-search file picker, inline file creation, image picker, and drag-and-drop/paste drop zone
- **Ghost task**: quick-start a timer without creating a saved task entry
- **Task import from notes**: scan any note's checklists and selectively import items (with clipboard paste support)
- **Archive**: completed and skipped tasks move to an archive with detail modal, restore, permanent delete, and auto-archive after configurable days
- **Confirmation dialogs**: destructive actions prompt confirmation; starting a task while another is running offers Start Now, Queue Next, or Cancel
- **Audio notifications**: synthesized tones on timer completion and overtime warning
- **Keyboard shortcuts**: Obsidian commands for start, pause, complete, skip, undo, redo, add-task, and pop-out
- **Undo/redo**: snapshot-based undo stack for all task mutations
- **Export analytics**: CSV export or append summary to today's daily note
- **Vault-side backup**: full JSON backup survives plugin reinstalls and updates
- **Dashboard deep link**: `obsidian://vault-dashboard` protocol handler
- **Pinned first tab**: auto-pins as the leftmost tab, survives layout changes
- **Onboarding walkthrough**: 4-step guide on first launch
- **Theme-aware**: all colors use Obsidian CSS variables, adapts to any theme
- **Responsive layout**: 2-column desktop grid collapses to single-column on mobile (<800px)

---

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

---

## Technical Highlights

- **Typed Event Bus**: decoupled pub/sub for cross-system communication. Commands, services, and UI sections interact through events, not direct method calls.
- **Interface-Based Registries**: `SectionRenderer` and `ModuleRenderer` interfaces for composable UI. Dashboard layout is data-driven, not hardcoded.
- **Pure-Logic Core Layer**: `core/` has zero Obsidian imports. TimerEngine, TaskManager, UndoManager, and AudioService are testable with plain Node.
- **Performance-Conscious Timer**: tick events (display-only, 4 Hz) are separated from state-change events (start/stop/pause). Timer ticks stay lightweight with no object copies, bus emissions for state, or save scheduling on the hot path. Intervals auto-stop when idle.
- **GPU-Composited Animations**: infinite CSS animations use `transform` and `will-change` hints to stay on the compositor thread and avoid layout/repaint thrashing.
- **Generic Undo/Redo**: `UndoManager<T>` provides snapshot-based undo for any state type. TaskManager uses it for task + archive snapshots.
- **Data-Driven Report Sources**: report modules read from user-configurable `ReportSourceConfig[]` in settings. Add, remove, or toggle sources from the settings panel.
- **AI Context Assembly**: AIDispatcher gathers task metadata, linked documents, and images into a structured prompt, then dispatches to Cursor CLI or Claude Code CLI. Each task can specify its own working directory.
- **Encapsulated View State**: no file-scope globals. All mutable UI state (collapsed IDs, filters, archive visibility) lives in typed `ViewState` objects owned by the view.

## Design Philosophy

The architecture applies composition-first principles: single responsibility per class, composition over inheritance, and decoupled event-driven communication. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full layer diagram, data flow, and design rationale.

## Extending the Plugin

**Custom modules**: Implement `ModuleRenderer` and call `plugin.registerModule()`. See [docs/API.md](docs/API.md) for the full interface, event list, and code examples.

**Custom sections**: Implement `SectionRenderer` with zone/order targeting.

---

## Project Structure

```
src/
  main.ts              -- Plugin entry, commands, ribbon, view registration
  WelcomeView.ts       -- Orchestrator composing sections + modules
  MiniTimerView.ts     -- Pop-out mini timer (Spotify-style compact view)
  SettingsTab.ts       -- Plugin settings panel

  core/                -- Zero Obsidian imports. Pure logic. Unit-testable.
    types.ts, EventBus.ts, events.ts, TimerEngine.ts,
    TaskManager.ts, UndoManager.ts, AudioService.ts, ColorUtils.ts,
    TaskFormatter.ts, ghost-task.ts, modal-tracker.ts, timer-controls.ts

  interfaces/          -- Contracts only (SectionRenderer, ModuleRenderer)

  sections/            -- SectionRenderer implementations (right column)
    TimerSection.ts, HeatmapBar.ts, TaskTimeline.ts, BoardView.ts,
    SubtaskTree.ts

  modules/             -- ModuleRenderer implementations (left column widgets)
    ModuleCard.ts, ModuleContainer.ts, ModuleRegistry.ts,
    ReportModule.ts, DocumentModule.ts, DispatchModule.ts

  services/            -- Obsidian-coupled vault/file operations
    AIDispatcher.ts, ReportScanner.ts, DocumentTracker.ts,
    AnalyticsExporter.ts, TaskImporter.ts, TaskParser.ts,
    BackupService.ts, VaultUtils.ts, PopoutPositionTracker.ts

  ui/                  -- Shared DOM components (Tooltip, DropZone, TimerRing, TagPills, setupDragHold)
  modals/              -- Obsidian modal dialogs (10 files)
  styles/              -- CSS (theme-aware)
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full layer diagram and dependency graph.

### Data Flow

```
Commands --> EventBus --> TimerSection / TaskManager / AudioService
                              |
TaskManager --> UndoManager --> EventBus("task:changed") --> data.json
                                                              |
WelcomeView <-- EventBus <-- TimerEngine("timer:tick") ------+
     |
     +--> SectionRenderer[] (by zone + order)
     +--> ModuleRegistry --> ModuleContainer --> [modules]
```

---

## Requirements

- **Obsidian** 1.0.0 or later
- **Node.js** 18+ (for building from source)
- **Optional**: Templater plugin (for calendar day-note creation from template)

## Installation

### From Source

```bash
git clone https://github.com/dudetru25/vault-dashboard.git
cd vault-dashboard
npm install
npm run build
```

Then symlink or copy the built plugin into your vault:

```bash
ln -s /path/to/vault-dashboard "/path/to/vault/.obsidian/plugins/vault-dashboard"
```

Enable **Vault Dashboard** in Obsidian > Settings > Community Plugins.

### Development

```bash
npm run dev    # Watch mode -- rebuilds on save
```

Reload Obsidian with `Cmd+R` (macOS) or `Ctrl+R` (Windows/Linux) after changes.

## Roadmap

- **Day Timeline**: Google Calendar-style time-block view (shelved while the interaction model is refined)

## License

MIT. See [LICENSE](LICENSE).

## Author

**Miguel A. Lopez** | [Rank Up Games LLC](https://github.com/dudetru25)
