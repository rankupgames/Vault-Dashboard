# API Reference

Public API for plugin consumers and third-party Obsidian plugins.

## Plugin Instance

Access the plugin from another Obsidian plugin:

```typescript
const vw = (this.app as any).plugins.plugins['vault-welcome'];
```

## Module Registration

### `registerModule(renderer: ModuleRenderer): void`

Register a custom widget panel in the dashboard's left column.

```typescript
vw.registerModule({
  id: 'my-widget',
  name: 'My Widget',
  renderContent(el: HTMLElement) {
    el.createDiv({ text: 'Hello from my widget!' });
  },
  destroy() { /* cleanup */ },
});
```

### `unregisterModule(id: string): void`

Remove a previously registered module.

```typescript
vw.unregisterModule('my-widget');
```

### `getModuleRegistry(): ModuleRegistry`

Access the full module registry for inspection.

```typescript
const registry = vw.getModuleRegistry();
const allModules = registry.getAll();
const hasWidget = registry.has('my-widget');
```

---

## ModuleRenderer Interface

```typescript
interface ModuleRenderer {
  /** Unique identifier for the module. */
  readonly id: string;

  /** Display name shown in the module card header. */
  readonly name: string;

  /** Whether to show a refresh button in the card header. */
  readonly showRefresh?: boolean;

  /** Render the module's content into the provided container. */
  renderContent(el: HTMLElement): void;

  /** Render additional actions in the card header bar. */
  renderHeaderActions?(actionsEl: HTMLElement): void;

  /** Cleanup resources when the module is removed. */
  destroy?(): void;
}
```

---

## SectionRenderer Interface

For adding custom dashboard sections (timer area, task area, etc.):

```typescript
type SectionZone = 'top-bar' | 'right-col' | 'left-col';

interface SectionRenderer {
  /** Unique identifier for the section. */
  readonly id: string;

  /** Which dashboard zone to render in. */
  readonly zone: SectionZone;

  /** Sort order within the zone (lower = earlier). */
  readonly order: number;

  /** Render the section into the provided parent element. */
  render(parent: HTMLElement): void;

  /** Called to refresh the section without a full re-render. */
  update?(): void;

  /** Cleanup resources. */
  destroy?(): void;
}
```

---

## EventBus

The plugin exposes its EventBus for cross-plugin event subscriptions:

```typescript
const bus = vw.eventBus;
```

### Subscribing

```typescript
const unsub = bus.on('task:complete', (payload) => {
  console.log('Task completed:', payload.taskId);
});

// Later: unsubscribe
unsub();
```

### Available Events

| Event | Payload | Description |
|-------|---------|-------------|
| `timer:tick` | `{ remaining: number, isNegative: boolean }` | Fires every 250ms while the timer runs |
| `timer:complete` | `{ taskId: string, rollover: number }` | Timer finished or task completed |
| `timer:break-complete` | `{ isLongBreak: boolean }` | Pomodoro break ended |
| `timer:state-change` | `{ state: TimerState }` | Any timer state mutation |
| `task:start` | `{ task: Task }` | Request to start a task |
| `task:skip` | `{ taskId: string }` | Request to skip the active task |
| `task:complete` | `{ taskId: string }` | Task marked complete |
| `task:changed` | `{}` | Any task list mutation |
| `view:render-all` | `{}` | Full dashboard re-render requested |
| `view:save` | `{}` | Data persistence requested |
| `audio:play-complete` | `{}` | Play completion sound |
| `audio:play-warning` | `{}` | Play overtime warning sound |

---

## Data Types

### Task

```typescript
interface Task {
  id: string;
  title: string;
  description?: string;
  durationMinutes: number;
  status: 'pending' | 'active' | 'completed' | 'skipped';
  order: number;
  createdAt: number;
  completedAt: number | null;
  tags?: string[];
  subtasks?: SubTask[];
  linkedDocs?: string[];
  images?: string[];
  delegationStatus?: 'none' | 'delegated' | 'completed';
}
```

### SubTask

```typescript
interface SubTask {
  id: string;
  title: string;
  status: 'pending' | 'completed';
  subtasks?: SubTask[];
}
```

### ModuleConfig

```typescript
interface ModuleConfig {
  id: string;
  name: string;
  enabled: boolean;
  order: number;
  collapsed: boolean;
  settings?: Record<string, unknown>;
}
```

### ReportSourceConfig

```typescript
interface ReportSourceConfig {
  id: string;
  label: string;
  folder: string;
  patternStr: string;
  frequency: 'daily' | 'weekly';
  enabled: boolean;
}
```

---

## Commands

All commands are registered under the `vault-welcome` prefix:

| Command | ID | Description |
|---------|----|-------------|
| Open Welcome Dashboard | `open-welcome-dashboard` | Activate or create the dashboard tab |
| Start Next Pending Task | `start-next-task` | Start the first pending task via EventBus |
| Pause / Resume Timer | `pause-resume` | Toggle timer pause state |
| Complete Current Task | `complete-current` | Stop the timer and complete the task |
| Skip Current Task | `skip-current` | Skip the active task via EventBus |
| Undo Last Task Action | `undo` | Restore previous task state |
| Redo Task Action | `redo` | Reapply undone task action |
| Add New Task | `open-add-task` | Open the add-task modal |
