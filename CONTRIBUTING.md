# Contributing

## Project Setup

```bash
git clone https://github.com/rankupgames/Vault-Dashboard.git
cd Vault-Dashboard
npm install
npm run dev    # Watch mode -- rebuilds on save
```

Symlink the repo into your vault's plugins folder:

```bash
ln -s /path/to/Vault-Dashboard "/path/to/vault/.obsidian/plugins/vault-welcome"
```

Reload Obsidian with `Cmd+R` / `Ctrl+R` after changes.

### Verification

Before submitting a PR, verify all three gates pass:

```bash
npm run lint   # ESLint with TypeScript rules
npm test       # Vitest -- core layer unit tests
npm run build  # esbuild production build
```

## Folder Structure

```
src/
  main.ts              -- Plugin entry point: commands, ribbon, view registration
  WelcomeView.ts       -- Orchestrator composing sections and modules into the dashboard
  SettingsTab.ts       -- Obsidian settings panel

  core/                -- Zero Obsidian imports. Pure logic. Unit-testable.
    types.ts           -- Shared interfaces, defaults, constants
    EventBus.ts        -- Typed pub/sub for decoupled communication
    events.ts          -- Event name constants and payload interfaces
    TimerEngine.ts     -- Clock-aligned countdown with rollover and pomodoro
    TaskManager.ts     -- Task CRUD, subtasks, ordering, archiving, undo
    UndoManager.ts     -- Generic snapshot-based undo/redo stack
    AudioService.ts    -- Web Audio API tone generator
    ColorUtils.ts      -- Hex/HSL conversion, shade generators

  interfaces/          -- Contracts only. No implementations, no deps.
    SectionRenderer.ts -- Dashboard section contract (zone, order, render)

  sections/            -- SectionRenderer implementations (right column)
    TimerSection.ts    -- Timer circle UI, SVG ring, controls
    HeatmapBar.ts      -- Contribution heatmap with streaks and stats
    TaskTimeline.ts    -- Task list with git-tree layout, archive, export
    SubtaskTree.ts     -- Subtask branch rendering with collapse

  modules/             -- ModuleRenderer implementations (left column widgets)
    ModuleCard.ts      -- Card chrome: header, collapse, refresh, drag
    ModuleContainer.ts -- Grid renderer with drag-and-drop reorder
    ModuleRegistry.ts  -- Central register/unregister for all modules
    ReportModule.ts    -- Daily and weekly report modules
    DocumentModule.ts  -- Last opened and quick access panels
    DispatchModule.ts  -- AI dispatch widget panel

  services/            -- Obsidian-coupled vault/file operations
    AIDispatcher.ts    -- AI context assembly and CLI dispatch
    ReportScanner.ts   -- Folder scanner with new-report detection
    DocumentTracker.ts -- Recent file and path resolution
    AnalyticsExporter.ts -- CSV and daily note export
    TaskImporter.ts    -- Note checklist scanner

  modals/              -- Obsidian modal dialogs
    TaskModal.ts, ImportModal.ts, FileSuggestModal.ts,
    ConfirmModal.ts, ConfirmStartModal.ts,
    ArchiveDetailModal.ts, PlanApprovalModal.ts

  ui/                  -- Shared DOM utilities
    Tooltip.ts         -- Custom tooltip and tag pill renderer
    OnboardingOverlay.ts -- First-run walkthrough
    DropZone.ts        -- Drag-and-drop file target

  styles/              -- CSS (13 files, theme-aware)

tests/
  core/                -- Vitest unit tests for the core layer
    EventBus.test.ts, UndoManager.test.ts, TaskManager.test.ts,
    ColorUtils.test.ts, TimerEngine.test.ts
```

## Coding Standards

TypeScript adaptation of the project's Unity C# standards:

- **Single responsibility**: Each class owns one idea. Effects and UI are listeners.
- **Composition over inheritance**: Stack small systems, never deep class trees.
- **Decoupled communication**: Use the EventBus for cross-system messages. Direct references only for strict ownership.
- **No `any`**: Use proper types. The codebase enforces this.
- **Explicit false checks**: Use `=== false` instead of `!`.
- **No file-scope mutable state**: All mutable state belongs in class instances or ViewState objects.
- **TSDoc on all exports**: Every exported interface, class, public method, and callback type must have a `/** */` comment.
- **Tabs for indentation**.

## Adding a New Section

1. Create `src/sections/MySection.ts`
2. Implement `SectionRenderer` (id, zone, order, render)
3. Add construction in `WelcomeView.buildSections()`
4. Add CSS in `src/styles/`
5. Export from `src/sections/index.ts`
6. Verify: `npm run build`

## Adding a New Module

1. Create `src/modules/MyModule.ts`
2. Implement `ModuleRenderer` (id, name, renderContent)
3. Register in `WelcomeView.registerBuiltinModules()` or via `plugin.registerModule()`
4. Add a `ModuleConfig` entry in `DEFAULT_SETTINGS.modules`
5. Export from `src/modules/index.ts`
6. Verify: `npm run build`

## Adding a New Service

1. Create `src/services/MyService.ts`
2. Keep Obsidian imports minimal. If it can be pure logic, put it in `core/` instead.
3. Export from `src/services/index.ts`
4. Wire into the consuming section or module via deps
5. Verify: `npm run build`

## PR Expectations

- All gates pass: `npm run lint && npm test && npm run build`
- TSDoc on all new exports
- Tests for new core logic (anything in `core/`)
- No file-scope mutable state
- No `any` types
- No `innerHTML` -- use Obsidian's `setIcon()` or DOM API
- Event-based communication for cross-system interactions
- One responsibility per file
