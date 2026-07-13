import { describe, expect, it, vi } from 'vitest';
import { TFile, type App } from 'obsidian';
import { TaskManager } from '../../src/core/TaskManager';
import {
	AI_TASKS_CATEGORY_ID,
	DEFAULT_SETTINGS,
	type AITaskManifestReceipt,
	type LinkedReference,
	type PluginSettings,
	type Task,
} from '../../src/core/types';
import {
	AITaskManifestIngestor,
	composeAITaskExecutionPrompt,
	getAITaskInboxPath,
	parseAITaskManifest,
	type AITaskManifest,
} from '../../src/services/AITaskCurator';

const makeSettings = (): PluginSettings => JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as PluginSettings;
const TEST_PROJECT_ROOT = process.cwd().replace(/\\/g, '/');

const makeTask = (id: string, title: string, order: number, overrides: Partial<Task> = {}): Task => ({
	id,
	title,
	durationMinutes: 30,
	status: 'pending',
	order,
	createdAt: 1_000 + order,
	categoryId: AI_TASKS_CATEGORY_ID,
	...overrides,
});

const makeReference = (
	id: string,
	targetId: string,
	path: string,
	line: number,
	text: string,
	state: 'active' | 'retired' = 'active',
): LinkedReference => ({
	id,
	kind: 'vault-checklist',
	targetKind: 'task',
	targetId,
	sourcePath: path,
	sourceLine: line,
	sourceText: text,
	sourceOccurrence: 0,
	state,
});

const makeManifest = (): AITaskManifest => ({
	schemaVersion: 1,
	manifestId: 'manifest-001',
	createdAt: '2026-07-13T12:00:00.000Z',
	actor: {
		sessionId: 'session-external-42',
		ai: 'Codex vault agent',
		model: 'gpt-test',
		moreInfo: 'Sessions/019f535f.md',
	},
	sources: [
		{
			sourceId: 'todo-api',
			path: 'Projects/API.md',
			line: 4,
			occurrence: 0,
			text: 'Condense the API script',
			projectRoot: TEST_PROJECT_ROOT,
		},
		{
			sourceId: 'todo-ui',
			path: 'Projects/UI.md',
			line: 8,
			occurrence: 0,
			text: 'Repair the release UI',
			projectRoot: TEST_PROJECT_ROOT,
		},
	],
	tasks: [{
		title: 'Ship the release',
		description: 'Complete the related API and UI release work.',
		durationMinutes: 120,
		projectRoot: TEST_PROJECT_ROOT,
		skills: ['curate-ai-tasks', 'typescript-testing'],
		tools: ['read-files', 'edit-files', 'run-checks'],
		sourceIds: ['todo-api', 'todo-ui'],
		subtasks: [
			{ title: 'Condense the implementation', sourceIds: ['todo-api'] },
			{ title: 'Finish the release surface', sourceIds: ['todo-ui'] },
		],
	}],
});

const makeHarness = (overrides: { app?: App; tasks?: Task[]; references?: LinkedReference[] } = {}) => {
	const settings = makeSettings();
	const tasks = overrides.tasks ?? [
		makeTask('task-api', 'Condense the API script', 0, {
			workingDirectory: `${TEST_PROJECT_ROOT}/`,
			images: ['Images/API.png'],
		}),
		makeTask('task-ui', 'Repair the release UI', 1, {
			subtasks: [{ id: 'existing-ui-check', title: 'Keep existing UI detail', status: 'pending' }],
			images: ['Images/UI.png'],
		}),
	];
	const references = overrides.references ?? [
		makeReference('ref-api', 'task-api', 'Projects/API.md', 4, 'Condense the API script'),
		makeReference('ref-ui', 'task-ui', 'Projects/UI.md', 8, 'Repair the release UI'),
		makeReference('ref-ui-retired', 'task-ui', 'Projects/UI-old.md', 3, 'Repair the release UI', 'retired'),
	];
	const receipts: AITaskManifestReceipt[] = [];
	const taskManager = new TaskManager(tasks, [], settings);
	const onDataChanged = vi.fn();
	const ingestor = new AITaskManifestIngestor({
		app: overrides.app ?? { vault: {} } as App,
		taskManager,
		getSettings: () => settings,
		getReferences: () => references,
		getReceipts: () => receipts,
		onDataChanged,
	});
	return { ingestor, onDataChanged, receipts, references, settings, taskManager };
};

describe('parseAITaskManifest', () => {
	it('accepts the exact external vault-agent contract', () => {
		const manifest = makeManifest();
		expect(parseAITaskManifest(JSON.stringify(manifest))).toEqual(manifest);
	});

	it.each([
		['extra root data', (manifest: Record<string, unknown>) => { manifest.extra = true; }],
		['an unsupported version', (manifest: Record<string, unknown>) => { manifest.schemaVersion = 2; }],
		['an unsafe manifest id', (manifest: Record<string, unknown>) => { manifest.manifestId = '../replace'; }],
		['an unknown source assignment', (manifest: Record<string, unknown>) => {
			((manifest.tasks as Array<Record<string, unknown>>)[0].sourceIds as string[])[0] = 'unknown';
		}],
		['a source omitted from all tasks', (manifest: Record<string, unknown>) => {
			(manifest.tasks as Array<Record<string, unknown>>)[0].sourceIds = ['todo-api'];
			(manifest.tasks as Array<Record<string, unknown>>)[0].subtasks = [{ title: 'Only API', sourceIds: ['todo-api'] }];
		}],
		['a source missing from task subgroups', (manifest: Record<string, unknown>) => {
			(manifest.tasks as Array<Record<string, unknown>>)[0].subtasks = [{ title: 'Only API', sourceIds: ['todo-api'] }];
		}],
		['a duplicated subgroup source', (manifest: Record<string, unknown>) => {
			(manifest.tasks as Array<Record<string, unknown>>)[0].subtasks = [
				{ title: 'First', sourceIds: ['todo-api', 'todo-ui'] },
				{ title: 'Second', sourceIds: ['todo-ui'] },
			];
		}],
		['mixed project roots', (manifest: Record<string, unknown>) => {
			((manifest.sources as Array<Record<string, unknown>>)[1]).projectRoot = '/workspace/other';
		}],
		['a relative project root', (manifest: Record<string, unknown>) => {
			for (const source of manifest.sources as Array<Record<string, unknown>>) source.projectRoot = 'relative/project';
			(manifest.tasks as Array<Record<string, unknown>>)[0].projectRoot = 'relative/project';
		}],
	] as const)('rejects %s', (_label, mutate) => {
		const manifest = structuredClone(makeManifest()) as unknown as Record<string, unknown>;
		mutate(manifest);
		expect(() => parseAITaskManifest(JSON.stringify(manifest))).toThrow();
	});
});

describe('AITaskManifestIngestor', () => {
	it('merges exact canonical sources, preserves raw TODOs, repoints references, and records external attribution', () => {
		const harness = makeHarness();
		const manifest = makeManifest();
		const path = `${getAITaskInboxPath(harness.settings)}/${manifest.manifestId}.json`;

		const result = harness.ingestor.ingest(path, JSON.stringify(manifest));

		expect(result).toEqual({
			status: 'ingested',
			manifestId: 'manifest-001',
			manifestPath: path,
			sourceTaskIds: ['task-api', 'task-ui'],
			taskIds: ['task-api'],
		});
		expect(harness.taskManager.getTask('task-ui')).toBeUndefined();
		const task = harness.taskManager.getTask('task-api');
		expect(task).toMatchObject({
			title: 'Ship the release',
			description: 'Complete the related API and UI release work.',
			durationMinutes: 120,
			workingDirectory: TEST_PROJECT_ROOT,
			categoryId: AI_TASKS_CATEGORY_ID,
		});
		expect(task?.subtasks?.map((subtask) => subtask.title)).toEqual([
			'Condense the implementation',
			'Finish the release surface',
		]);
		expect(task?.subtasks?.[0].subtasks?.[0].title).toBe('Condense the API script');
		expect(task?.subtasks?.[1].subtasks?.[0].title).toBe('Repair the release UI');
		expect(task?.subtasks?.[1].subtasks?.[0].subtasks?.[0].title).toBe('Keep existing UI detail');
		expect(task?.images).toEqual(['Images/API.png', 'Images/UI.png']);
		expect(task?.aiAttribution).toMatchObject({
			manifestId: 'manifest-001',
			manifestPath: path,
			sessionId: 'session-external-42',
			agent: 'Codex vault agent',
			model: 'gpt-test',
			moreInfo: 'Sessions/019f535f.md',
			sourceTaskIds: ['task-api', 'task-ui'],
			sourceReferenceIds: ['ref-api', 'ref-ui'],
			sourcePaths: ['Projects/API.md', 'Projects/UI.md'],
			skills: manifest.tasks[0].skills,
			tools: manifest.tasks[0].tools,
		});
		expect(harness.references.every((reference) => reference.targetId === 'task-api')).toBe(true);
		expect(harness.receipts).toHaveLength(1);
		expect(harness.receipts[0]).toMatchObject({ manifestId: 'manifest-001', manifestPath: path });
		expect(harness.onDataChanged).toHaveBeenCalledOnce();
		expect(harness.taskManager.getUndoManager().canUndo()).toBe(false);
	});

	it('treats an identical manifest replay as unchanged without another mutation', () => {
		const harness = makeHarness();
		const manifest = makeManifest();
		const path = `_Vaultboard/ai-tasks/inbox/${manifest.manifestId}.json`;
		const raw = JSON.stringify(manifest);
		harness.ingestor.ingest(path, raw);
		const snapshot = harness.taskManager.toJSON();
		harness.onDataChanged.mockClear();

		expect(harness.ingestor.ingest(path, `\n${raw}\n`)).toMatchObject({ status: 'unchanged', taskIds: ['task-api'] });
		expect(harness.taskManager.toJSON()).toEqual(snapshot);
		expect(harness.receipts).toHaveLength(1);
		expect(harness.onDataChanged).not.toHaveBeenCalled();
	});

	it('rejects an overwrite with the same id and path before mutating tasks or receipts', () => {
		const harness = makeHarness();
		const manifest = makeManifest();
		const path = `_Vaultboard/ai-tasks/inbox/${manifest.manifestId}.json`;
		harness.ingestor.ingest(path, JSON.stringify(manifest));
		const snapshot = harness.taskManager.toJSON();
		const changed = structuredClone(manifest);
		changed.tasks[0].title = 'Silently replaced title';

		expect(() => harness.ingestor.ingest(path, JSON.stringify(changed))).toThrow(/overwrites are not allowed/i);
		expect(harness.taskManager.toJSON()).toEqual(snapshot);
		expect(harness.receipts).toHaveLength(1);
	});

	it('rejects an unknown canonical source selector before any task or reference mutation', () => {
		const harness = makeHarness();
		const manifest = makeManifest();
		manifest.sources[1].line = 999;
		const tasksBefore = harness.taskManager.toJSON();
		const referencesBefore = structuredClone(harness.references);

		expect(() => harness.ingestor.ingest(
			`_Vaultboard/ai-tasks/inbox/${manifest.manifestId}.json`,
			JSON.stringify(manifest),
		)).toThrow(/exactly one active canonical TODO reference/i);
		expect(harness.taskManager.toJSON()).toEqual(tasksBefore);
		expect(harness.references).toEqual(referencesBefore);
		expect(harness.receipts).toHaveLength(0);
	});

	it('rejects a manifest root that conflicts with a source task configured root', () => {
		const harness = makeHarness({
			tasks: [
				makeTask('task-api', 'Condense the API script', 0, { workingDirectory: '/workspace/conflict' }),
				makeTask('task-ui', 'Repair the release UI', 1),
			],
		});
		const manifest = makeManifest();

		expect(() => harness.ingestor.ingest(
			`_Vaultboard/ai-tasks/inbox/${manifest.manifestId}.json`,
			JSON.stringify(manifest),
		)).toThrow(/configured project root/i);
		expect(harness.taskManager.getTask('task-api')?.title).toBe('Condense the API script');
		expect(harness.receipts).toHaveLength(0);
	});

	it('continues past a malformed inbox file and ingests later valid manifests', async () => {
		const manifest = makeManifest();
		const invalidFile = new TFile('_Vaultboard/ai-tasks/inbox/a-invalid.json');
		const validFile = new TFile(`_Vaultboard/ai-tasks/inbox/${manifest.manifestId}.json`);
		const contents = new Map([
			[invalidFile.path, '{invalid'],
			[validFile.path, JSON.stringify(manifest)],
		]);
		const app = {
			vault: {
				getFiles: () => [validFile, invalidFile],
				cachedRead: async (file: TFile) => contents.get(file.path) ?? '',
			},
		} as unknown as App;
		const harness = makeHarness({ app });

		const results = await harness.ingestor.ingestInbox();

		expect(results.map((result) => result.status)).toEqual(['failed', 'ingested']);
		expect(harness.taskManager.getTask('task-api')?.title).toBe('Ship the release');
	});
});

describe('composeAITaskExecutionPrompt', () => {
	it('uses only the external attribution and per-task skills/tools', () => {
		const harness = makeHarness();
		const manifest = makeManifest();
		harness.ingestor.ingest(`_Vaultboard/ai-tasks/inbox/${manifest.manifestId}.json`, JSON.stringify(manifest));
		const task = harness.taskManager.getTask('task-api') as Task;

		harness.settings.aiTaskSkills = ['session-skill'];
		harness.settings.aiTaskTools = ['session-tool'];
		const prompt = composeAITaskExecutionPrompt(task, harness.settings, TEST_PROJECT_ROOT);

		for (const expected of [
			'manifest-001',
			'_Vaultboard/ai-tasks/inbox/manifest-001.json',
			'session-external-42',
			'Codex vault agent/gpt-test',
			'Sessions/019f535f.md',
			TEST_PROJECT_ROOT,
			'curate-ai-tasks',
			'session-skill',
			'run-checks',
			'session-tool',
			'Condense the API script',
		]) expect(prompt).toContain(expected);
		expect(prompt).not.toContain('Vaultboard dispatch');
	});

	it('rejects launch when the project or Vault root is not an existing directory', () => {
		const harness = makeHarness();
		const manifest = makeManifest();
		harness.ingestor.ingest(`_Vaultboard/ai-tasks/inbox/${manifest.manifestId}.json`, JSON.stringify(manifest));
		const task = harness.taskManager.getTask('task-api') as Task;
		const missingRoot = `${TEST_PROJECT_ROOT}/definitely-not-a-real-vaultboard-directory`;

		expect(() => composeAITaskExecutionPrompt(task, harness.settings, missingRoot)).toThrow(/Vault root/i);
		task.workingDirectory = missingRoot;
		expect(() => composeAITaskExecutionPrompt(task, harness.settings, TEST_PROJECT_ROOT)).toThrow(/Project root/i);
	});
});
