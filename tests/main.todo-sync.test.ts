import { describe, expect, it, vi, type Mock } from 'vitest';

const notices = vi.hoisted(() => [] as string[]);

vi.mock('obsidian', () => {
	class Plugin {}
	class WorkspaceLeaf {}
	class TAbstractFile {
		path: string;

		constructor(path = '') {
			this.path = path;
		}
	}
	class TFile extends TAbstractFile {
		extension: string;

		constructor(path: string) {
			super(path);
			this.extension = path.split('.').pop() ?? '';
		}
	}
	class Notice {
		constructor(message: string) {
			notices.push(message);
		}
	}
	return {
		Notice,
		Plugin,
		WorkspaceLeaf,
		TAbstractFile,
		TFile,
		normalizePath: (path: string) => path.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^\.\//, ''),
	};
});

vi.mock('../src/WelcomeView', () => ({ WelcomeView: class {} }));
vi.mock('../src/MiniTimerView', () => ({ MiniTimerView: class {} }));
vi.mock('../src/SettingsTab', () => ({ SettingsTab: class {} }));
vi.mock('../src/core/AudioService', () => ({ AudioService: class {} }));
vi.mock('../src/services/AIDispatcher', () => ({
	AIDispatcher: class {},
	normalizeOpenRouterBaseUrl: vi.fn((value: string) => value),
	validateToolPath: vi.fn(() => true),
}));
vi.mock('../src/ui/Tooltip', () => ({ destroyTooltip: vi.fn() }));
vi.mock('../src/core/modal-tracker', () => ({ closeAllModals: vi.fn() }));
vi.mock('../src/services/BackupService', () => ({ BackupService: { write: vi.fn() } }));
vi.mock('../src/services/PopoutPositionTracker', () => ({ PopoutPositionTracker: class {} }));
vi.mock('../src/services/TodoSyncService', () => ({ TodoSyncService: class {} }));

import { TFile } from 'obsidian';
import VaultboardPlugin from '../src/main';
import { AI_TASKS_CATEGORY_ID, DEFAULT_SETTINGS, type PluginData } from '../src/core/types';
import type { TodoSyncSummary } from '../src/services/TodoSyncService';

interface TodoSyncServiceStub {
	drain: Mock<() => Promise<void>>;
	renameSource: Mock<(oldPath: string, newPath: string) => Promise<void>>;
	retireSource: Mock<(path: string) => Promise<number>>;
	syncAll: Mock<() => Promise<TodoSyncSummary>>;
	syncFile: Mock<(file: TFile) => Promise<TodoSyncSummary>>;
}

interface PluginHarness {
	data: { settings: { autoImportTodos: boolean; outputFolder: string } };
	vaultIngestionQueue: Promise<void>;
	todoSyncService: TodoSyncServiceStub;
	aiTaskManifestIngestor: { ingestFile: Mock };
	refreshWelcomeViews: Mock;
	ingestChangedVaultFile: (file: TFile) => Promise<void>;
	ingestAITaskManifestFile: (file: TFile) => Promise<unknown>;
	syncVaultTodoFile: (file: TFile) => Promise<void>;
	handleVaultTodoRename: (file: TFile, oldPath: string) => Promise<void>;
	handleVaultTodoDelete: (file: TFile) => Promise<void>;
	syncVaultTodos: (showNotice?: boolean) => Promise<TodoSyncSummary>;
}

const makeHarness = (autoImportTodos: boolean): PluginHarness => {
	const service: TodoSyncServiceStub = {
		drain: vi.fn().mockResolvedValue(undefined),
		renameSource: vi.fn().mockResolvedValue(undefined),
		retireSource: vi.fn().mockResolvedValue(0),
		syncAll: vi.fn().mockResolvedValue({ added: 0, linked: 0, retired: 0 }),
		syncFile: vi.fn().mockResolvedValue({ added: 0, linked: 0, retired: 0 }),
	};
	return Object.assign(Object.create(VaultboardPlugin.prototype), {
		data: { settings: { autoImportTodos, outputFolder: '_Vaultboard' } },
		vaultIngestionQueue: Promise.resolve(),
		todoSyncService: service,
		aiTaskManifestIngestor: {
			ingestFile: vi.fn().mockResolvedValue({ status: 'ingested', manifestId: 'plan-1', taskIds: ['task-1'] }),
		},
		refreshWelcomeViews: vi.fn(),
	}) as PluginHarness;
};

const makeFile = (path: string): TFile => {
	const FileCtor = TFile as unknown as new (filePath: string) => TFile;
	return new FileCtor(path);
};

describe('VaultboardPlugin TODO synchronization boundaries', () => {
	it('refreshes after rename maintenance without ingesting while automatic import is disabled', async () => {
		const plugin = makeHarness(false);
		const renamedFile = makeFile('Notes/Renamed.md');
		const syncFile = vi.fn().mockResolvedValue(undefined);
		plugin.syncVaultTodoFile = syncFile;

		await plugin.handleVaultTodoRename(renamedFile, 'Notes/Original.md');

		expect(plugin.todoSyncService.renameSource).toHaveBeenCalledWith('Notes/Original.md', 'Notes/Renamed.md');
		expect(syncFile).not.toHaveBeenCalled();
		expect(plugin.refreshWelcomeViews).toHaveBeenCalledOnce();
	});

	it('refreshes after delete maintenance while automatic import is disabled', async () => {
		const plugin = makeHarness(false);
		const deletedFile = makeFile('Notes/Deleted.md');
		plugin.todoSyncService.retireSource.mockResolvedValue(2);

		await plugin.handleVaultTodoDelete(deletedFile);

		expect(plugin.todoSyncService.retireSource).toHaveBeenCalledWith('Notes/Deleted.md');
		expect(plugin.refreshWelcomeViews).toHaveBeenCalledOnce();
	});

	it('refreshes open dashboards when a full sync links existing TODOs', async () => {
		const plugin = makeHarness(true);
		plugin.todoSyncService.syncAll.mockResolvedValue({ added: 0, linked: 1, retired: 0 });

		await plugin.syncVaultTodos();

		expect(plugin.refreshWelcomeViews).toHaveBeenCalledOnce();
	});

	it('refreshes open dashboards when a changed file links existing TODOs', async () => {
		const plugin = makeHarness(true);
		plugin.todoSyncService.syncFile.mockResolvedValue({ added: 0, linked: 1, retired: 0 });

		await plugin.syncVaultTodoFile(makeFile('Notes/Todos.md'));

		expect(plugin.refreshWelcomeViews).toHaveBeenCalledOnce();
	});

	it('routes inbox JSON to external manifest ingestion even when automatic TODO import is disabled', async () => {
		const plugin = makeHarness(false);
		const syncTodo = vi.fn().mockResolvedValue(undefined);
		plugin.syncVaultTodoFile = syncTodo;
		const file = makeFile('_Vaultboard/ai-tasks/inbox/plan-1.json');

		await plugin.ingestChangedVaultFile(file);

		expect(plugin.aiTaskManifestIngestor.ingestFile).toHaveBeenCalledWith(file);
		expect(syncTodo).not.toHaveBeenCalled();
		expect(plugin.refreshWelcomeViews).toHaveBeenCalledOnce();
	});

	it('reports a malformed external manifest without refreshing task views', async () => {
		const plugin = makeHarness(false);
		plugin.aiTaskManifestIngestor.ingestFile.mockRejectedValue(new Error('invalid manifest'));
		const file = makeFile('_Vaultboard/ai-tasks/inbox/plan-1.json');

		await plugin.ingestAITaskManifestFile(file);

		expect(plugin.refreshWelcomeViews).not.toHaveBeenCalled();
		expect(notices.at(-1)).toContain('External AI task manifest failed');
	});

	it('waits for queued Vault ingestion before destroying services on unload', async () => {
		const plugin = makeHarness(false);
		let finishIngestion = (): void => undefined;
		plugin.vaultIngestionQueue = new Promise<void>((resolve) => {
			finishIngestion = resolve;
		});
		const releaseMiniTimer = vi.fn();
		Object.assign(plugin, {
			miniTimerTracker: { release: releaseMiniTimer },
			aiDispatcher: { killAll: vi.fn() },
			timerEngine: { destroy: vi.fn() },
			audioService: { destroy: vi.fn() },
			eventBus: { destroy: vi.fn() },
			saveTimeout: null,
			dayCheckInterval: null,
			app: { workspace: { detachLeavesOfType: vi.fn() } },
		});

		const unload = (plugin as unknown as { onunload: () => Promise<void> }).onunload();
		await Promise.resolve();
		expect(releaseMiniTimer).not.toHaveBeenCalled();

		finishIngestion();
		await unload;
		expect(plugin.todoSyncService.drain).toHaveBeenCalledOnce();
		expect(releaseMiniTimer).toHaveBeenCalledOnce();
	});
});

describe('VaultboardPlugin TODO intake migration', () => {
	it('restores AI Tasks and moves only live canonical targets, including retired references', async () => {
		const saved = {
			settings: {
				...DEFAULT_SETTINGS,
				todoCategoryId: 'custom-imports',
				aiTaskSkills: 'invalid',
				aiTaskTools: null,
				taskCategories: [
					{ id: 'default-daily', name: 'Renamed daily', order: 9, color: '#123456' },
					{ id: 'default-general', name: 'Renamed general', order: 8 },
					{ id: 'custom-imports', name: 'Imports', order: 1 },
				],
			},
			tasks: [
				{ id: 'active-target', title: 'Active TODO', categoryId: 'default-general' },
				{ id: 'retired-target', title: 'Retired TODO', categoryId: 'custom-imports' },
				{ id: 'user-general', title: 'User General', categoryId: 'default-general' },
			],
			archivedTasks: [],
				references: [
				{
					id: 'ref-active', kind: 'vault-checklist', targetKind: 'task', targetId: 'active-target',
					sourcePath: 'Notes/A.md', sourceLine: 1, sourceText: 'Active TODO', sourceOccurrence: 0, state: 'active',
				},
				{
					id: 'ref-retired', kind: 'vault-checklist', targetKind: 'task', targetId: 'retired-target',
					sourcePath: 'Notes/B.md', sourceLine: 2, sourceText: 'Retired TODO', sourceOccurrence: 0, state: 'retired',
				},
				],
				aiTaskManifestReceipts: [
					{
						manifestId: 'plan-1', manifestPath: '_Vaultboard/ai-tasks/inbox/plan-1.json',
						fingerprint: 'fnv1a32:12345678', ingestedAt: 100,
						sourceTaskIds: ['active-target'], taskIds: ['active-target'],
					},
					{ manifestId: 'invalid-receipt' },
				],
		};
		const plugin = Object.assign(Object.create(VaultboardPlugin.prototype), {
			loadData: vi.fn().mockResolvedValue(saved),
		}) as VaultboardPlugin & { data: PluginData };

		await (plugin as unknown as { loadData_: () => Promise<void> }).loadData_();

		expect(plugin.data.settings.todoCategoryId).toBe(AI_TASKS_CATEGORY_ID);
		expect(plugin.data.settings.aiTaskSkills).toEqual(DEFAULT_SETTINGS.aiTaskSkills);
		expect(plugin.data.settings.aiTaskTools).toEqual(DEFAULT_SETTINGS.aiTaskTools);
		expect(plugin.data.settings.taskCategories.slice(0, 3)).toEqual([
			{ id: 'default-daily', name: 'Daily Tasks', order: 0, isDefault: true, dailyReset: true, color: '#123456' },
			{ id: 'default-general', name: 'General', order: 1, isDefault: true },
			{ id: AI_TASKS_CATEGORY_ID, name: 'AI Tasks', order: 2, isDefault: true },
		]);
		expect(plugin.data.tasks.find((task) => task.id === 'active-target')?.categoryId).toBe(AI_TASKS_CATEGORY_ID);
		expect(plugin.data.tasks.find((task) => task.id === 'retired-target')?.categoryId).toBe(AI_TASKS_CATEGORY_ID);
			expect(plugin.data.tasks.find((task) => task.id === 'user-general')?.categoryId).toBe('default-general');
			expect(plugin.data.aiTaskManifestReceipts).toEqual([{
				manifestId: 'plan-1', manifestPath: '_Vaultboard/ai-tasks/inbox/plan-1.json',
				fingerprint: 'fnv1a32:12345678', ingestedAt: 100,
				sourceTaskIds: ['active-target'], taskIds: ['active-target'],
			}]);
		});
});
