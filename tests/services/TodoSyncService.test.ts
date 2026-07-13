import { describe, expect, it, vi } from 'vitest';
import { TFile, type App } from 'obsidian';
import { TaskManager } from '../../src/core/TaskManager';
import {
	AI_TASKS_CATEGORY_ID,
	DEFAULT_SETTINGS,
	type LinkedReference,
	type PluginSettings,
} from '../../src/core/types';
import { TodoSyncService } from '../../src/services/TodoSyncService';

/** Creates isolated settings with automatic TODO sync enabled for tests. */
const makeSettings = (): PluginSettings => ({
	...JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
	autoImportTodos: true,
	todoSourceFolder: 'Projects',
});

/** Creates a narrow Vault mock backed by mutable Markdown strings. */
const makeApp = (files: TFile[], contents: Record<string, string>): App => ({
	vault: {
		getMarkdownFiles: () => files,
		read: async (file: TFile) => contents[file.path],
	},
}) as unknown as App;

/** Creates a manually released promise for deterministic synchronization races. */
const makeDeferred = (): { promise: Promise<void>; resolve: () => void } => {
	let resolve = (): void => undefined;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
};

describe('TodoSyncService', () => {
	it('imports pending checklists once and retains one canonical reference per source item', async () => {
		const file = new TFile('Projects/Plan.md');
		const contents = {
			[file.path]: '- [ ] First\n  - [ ] Child\n- [x] Done\n- [ ] Repeat\n- [ ] Repeat',
		};
		const settings = makeSettings();
		const references: LinkedReference[] = [];
		const taskManager = new TaskManager([], [], settings);
		const onReferencesChanged = vi.fn();
		const service = new TodoSyncService(makeApp([file], contents), taskManager, {
			getSettings: () => settings,
			getReferences: () => references,
			onReferencesChanged,
		});

		const first = await service.syncAll();
		const second = await service.syncAll();

		expect(first).toEqual({ added: 3, linked: 0, retired: 0 });
		expect(second).toEqual({ added: 0, linked: 3, retired: 0 });
		expect(taskManager.getTasks().map((task) => task.title)).toEqual(['First', 'Repeat', 'Repeat']);
		expect(taskManager.getTasks().every((task) => task.categoryId === AI_TASKS_CATEGORY_ID)).toBe(true);
		expect(taskManager.getTasks()[0].subtasks?.[0].title).toBe('Child');
		expect(references).toHaveLength(3);
		expect(new Set(references.map((reference) => reference.id)).size).toBe(3);
		expect(onReferencesChanged).toHaveBeenCalledTimes(1);
		expect(taskManager.getUndoManager().canUndo()).toBe(false);
	});

	it('matches moved lines, updates renamed paths, and retires checked-off sources', async () => {
		const file = new TFile('Projects/Plan.md');
		const contents = { [file.path]: '- [ ] Ship docs' };
		const settings = makeSettings();
		const references: LinkedReference[] = [];
		const taskManager = new TaskManager([], [], settings);
		const service = new TodoSyncService(makeApp([file], contents), taskManager, {
			getSettings: () => settings,
			getReferences: () => references,
			onReferencesChanged: vi.fn(),
		});
		await service.syncAll();

		contents[file.path] = '# Heading\n\n- [ ] Ship docs';
		const moved = await service.syncFile(file);
		await service.renameSource('Projects/Plan.md', 'Projects/Renamed.md');
		file.path = 'Projects/Renamed.md';
		contents[file.path] = '- [x] Ship docs';
		const completed = await service.syncFile(file);

		expect(moved).toEqual({ added: 0, linked: 1, retired: 0 });
		expect(completed).toEqual({ added: 0, linked: 0, retired: 1 });
		expect(taskManager.getTasks()).toHaveLength(1);
		expect(references[0]).toMatchObject({
			sourcePath: 'Projects/Renamed.md',
			sourceLine: 3,
			state: 'retired',
		});
	});

	it('ignores Markdown notes outside the configured source folder', async () => {
		const file = new TFile('Other/Plan.md');
		const settings = makeSettings();
		const references: LinkedReference[] = [];
		const taskManager = new TaskManager([], [], settings);
		const service = new TodoSyncService(makeApp([file], { [file.path]: '- [ ] Hidden' }), taskManager, {
			getSettings: () => settings,
			getReferences: () => references,
			onReferencesChanged: vi.fn(),
		});

		expect(await service.syncAll()).toEqual({ added: 0, linked: 0, retired: 0 });
		expect(taskManager.getTasks()).toHaveLength(0);
		expect(references).toHaveLength(0);
	});

	it('keeps a unique pending item linked when completed duplicates above it are removed', async () => {
		const file = new TFile('Projects/Plan.md');
		const contents = { [file.path]: '- [x] Repeat\n- [ ] Repeat' };
		const settings = makeSettings();
		const references: LinkedReference[] = [];
		const taskManager = new TaskManager([], [], settings);
		const service = new TodoSyncService(makeApp([file], contents), taskManager, {
			getSettings: () => settings,
			getReferences: () => references,
			onReferencesChanged: vi.fn(),
		});
		await service.syncAll();

		contents[file.path] = '- [ ] Repeat';
		const result = await service.syncFile(file);

		expect(result).toEqual({ added: 0, linked: 1, retired: 0 });
		expect(taskManager.getTasks()).toHaveLength(1);
		expect(references[0]).toMatchObject({ sourceLine: 1, sourceOccurrence: 0, state: 'active' });
	});

	it('keeps the surviving duplicate linked after its completed twin is deleted', async () => {
		const file = new TFile('Projects/Plan.md');
		const contents = { [file.path]: '- [ ] Repeat\n- [ ] Repeat' };
		const settings = makeSettings();
		const references: LinkedReference[] = [];
		const taskManager = new TaskManager([], [], settings);
		const service = new TodoSyncService(makeApp([file], contents), taskManager, {
			getSettings: () => settings,
			getReferences: () => references,
			onReferencesChanged: vi.fn(),
		});
		await service.syncAll();
		const firstReference = references.find((reference) => reference.sourceOccurrence === 0);
		const survivingReference = references.find((reference) => reference.sourceOccurrence === 1);
		expect(firstReference).toBeDefined();
		expect(survivingReference).toBeDefined();

		contents[file.path] = '- [x] Repeat\n- [ ] Repeat';
		await service.syncFile(file);
		expect(firstReference?.state).toBe('retired');
		expect(survivingReference?.state).toBe('active');

		contents[file.path] = '- [ ] Repeat';
		const result = await service.syncFile(file);

		expect(result).toEqual({ added: 0, linked: 1, retired: 0 });
		expect(firstReference?.state).toBe('retired');
		expect(survivingReference).toMatchObject({
			sourceLine: 1,
			sourceOccurrence: 0,
			state: 'active',
		});
	});

	it('preserves existing identities when a new TODO is inserted above reordered lines', async () => {
		const file = new TFile('Projects/Plan.md');
		const contents = { [file.path]: '- [ ] Alpha\n- [ ] Beta' };
		const settings = makeSettings();
		const references: LinkedReference[] = [];
		const taskManager = new TaskManager([], [], settings);
		const service = new TodoSyncService(makeApp([file], contents), taskManager, {
			getSettings: () => settings,
			getReferences: () => references,
			onReferencesChanged: vi.fn(),
		});
		await service.syncAll();
		const originalTargets = new Map(references.map((reference) => [reference.sourceText, reference.targetId]));

		contents[file.path] = '- [ ] New\n- [ ] Alpha\n- [ ] Beta';
		const result = await service.syncFile(file);

		expect(result).toEqual({ added: 1, linked: 2, retired: 0 });
		expect(references.find((reference) => reference.sourceText === 'Alpha')?.targetId).toBe(originalTargets.get('Alpha'));
		expect(references.find((reference) => reference.sourceText === 'Beta')?.targetId).toBe(originalTargets.get('Beta'));
		expect(taskManager.getTasks().map((task) => task.title)).toEqual(['Alpha', 'Beta', 'New']);
	});

	it('serializes overlapping scans so concurrent events cannot duplicate tasks', async () => {
		const file = new TFile('Projects/Plan.md');
		const settings = makeSettings();
		const references: LinkedReference[] = [];
		const taskManager = new TaskManager([], [], settings);
		const app = makeApp([file], { [file.path]: '- [ ] Concurrent' });
		const service = new TodoSyncService(app, taskManager, {
			getSettings: () => settings,
			getReferences: () => references,
			onReferencesChanged: vi.fn(),
		});

		const [first, second] = await Promise.all([service.syncFile(file), service.syncFile(file)]);

		expect(first.added + second.added).toBe(1);
		expect(taskManager.getTasks()).toHaveLength(1);
		expect(references).toHaveLength(1);
	});

	it('serializes source renames after an in-flight scan', async () => {
		const file = new TFile('Projects/Plan.md');
		const settings = makeSettings();
		const references: LinkedReference[] = [];
		const taskManager = new TaskManager([], [], settings);
		const readStarted = makeDeferred();
		const releaseRead = makeDeferred();
		const app = {
			vault: {
				getMarkdownFiles: () => [file],
				read: async () => {
					readStarted.resolve();
					await releaseRead.promise;
					return '- [ ] Rename race';
				},
			},
		} as unknown as App;
		const service = new TodoSyncService(app, taskManager, {
			getSettings: () => settings,
			getReferences: () => references,
			onReferencesChanged: vi.fn(),
		});

		const scan = service.syncFile(file);
		await readStarted.promise;
		const rename = service.renameSource('Projects/Plan.md', 'Projects/Renamed.md');
		releaseRead.resolve();
		await Promise.all([scan, rename]);

		expect(references).toHaveLength(1);
		expect(references[0].sourcePath).toBe('Projects/Renamed.md');
	});

	it('serializes source retirement after an in-flight scan', async () => {
		const file = new TFile('Projects/Plan.md');
		const settings = makeSettings();
		const references: LinkedReference[] = [];
		const taskManager = new TaskManager([], [], settings);
		const readStarted = makeDeferred();
		const releaseRead = makeDeferred();
		let blockRead = false;
		const app = {
			vault: {
				getMarkdownFiles: () => [file],
				read: async () => {
					if (blockRead) {
						readStarted.resolve();
						await releaseRead.promise;
					}
					return '- [ ] Retire race';
				},
			},
		} as unknown as App;
		const service = new TodoSyncService(app, taskManager, {
			getSettings: () => settings,
			getReferences: () => references,
			onReferencesChanged: vi.fn(),
		});
		await service.syncFile(file);
		blockRead = true;

		const scan = service.syncFile(file);
		await readStarted.promise;
		const retirement = service.retireSource(file.path);
		releaseRead.resolve();
		await Promise.all([scan, retirement]);

		expect(references[0].state).toBe('retired');
	});

	it('rewrites and retires descendant references for folder events and scope changes', async () => {
		const file = new TFile('Projects/Nested/Plan.md');
		const settings = makeSettings();
		const references: LinkedReference[] = [];
		const taskManager = new TaskManager([], [], settings);
		const service = new TodoSyncService(makeApp([file], { [file.path]: '- [ ] Nested' }), taskManager, {
			getSettings: () => settings,
			getReferences: () => references,
			onReferencesChanged: vi.fn(),
		});
		await service.syncAll();

		await service.renameSource('Projects/Nested', 'Projects/Renamed');
		expect(references[0].sourcePath).toBe('Projects/Renamed/Plan.md');
		expect(await service.retireSource('Projects/Renamed')).toBe(1);
		references[0].state = 'active';
		settings.todoSourceFolder = 'Other';
		await service.syncAll();

		expect(references[0].state).toBe('retired');
	});

	it('retires renamed sources that leave the configured Markdown scope', async () => {
		const file = new TFile('Projects/Nested/Plan.md');
		const settings = makeSettings();
		const references: LinkedReference[] = [];
		const taskManager = new TaskManager([], [], settings);
		const service = new TodoSyncService(makeApp([file], { [file.path]: '- [ ] Nested' }), taskManager, {
			getSettings: () => settings,
			getReferences: () => references,
			onReferencesChanged: vi.fn(),
		});
		await service.syncAll();

		await service.renameSource(file.path, 'Other/Plan.md');
		expect(references[0]).toMatchObject({ sourcePath: 'Other/Plan.md', state: 'retired' });

		references[0].state = 'active';
		await service.renameSource('Other/Plan.md', 'Projects/Plan.txt');
		expect(references[0]).toMatchObject({ sourcePath: 'Projects/Plan.txt', state: 'retired' });
	});

	it('routes manual imports through the canonical registry', async () => {
		const settings = makeSettings();
		const references: LinkedReference[] = [];
		const taskManager = new TaskManager([], [], settings);
		const service = new TodoSyncService(makeApp([], {}), taskManager, {
			getSettings: () => settings,
			getReferences: () => references,
			onReferencesChanged: vi.fn(),
		});
		const request = {
			title: 'Manual',
			subtasks: [],
			sourcePath: 'Projects/Plan.md',
			sourceLine: 4,
			sourceOccurrence: 0,
			durationMinutes: 45,
			categoryId: 'default-general',
		};

		expect((await service.importTodo(request))?.title).toBe('Manual');
		expect(await service.importTodo(request)).toBeUndefined();
		expect(taskManager.getTasks()).toHaveLength(1);
		expect(taskManager.getTasks()[0].categoryId).toBe(AI_TASKS_CATEGORY_ID);
		expect(references).toHaveLength(1);
		expect(taskManager.getUndoManager().canUndo()).toBe(false);
	});
});
