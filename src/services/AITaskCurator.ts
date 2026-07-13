/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vaultboard
 * Description: Strict ingestion of externally authored, vault-resident AI task manifests
 * Created: 2026-07-13
 */

import { statSync } from 'fs';
import { App, normalizePath, TFile } from 'obsidian';
import {
	AI_TASKS_CATEGORY_ID,
	type AITaskAttribution,
	type AITaskManifestReceipt,
	type LinkedReference,
	type PluginSettings,
	type SubTask,
	type Task,
} from '../core/types';
import type { TaskManager } from '../core/TaskManager';

/** Current strict external manifest schema version. */
export const AI_TASK_MANIFEST_SCHEMA_VERSION = 1;

/** External agent identity recorded by an AI task manifest. */
export interface AITaskManifestActor {
	sessionId: string;
	ai: string;
	model?: string;
	moreInfo?: string;
}

/** Stable selector for one canonical Vault checklist reference. */
export interface AITaskManifestSource {
	sourceId: string;
	path: string;
	line: number;
	occurrence: number;
	text: string;
	projectRoot: string;
}

/** One actionable group inside a themed task. */
export interface AITaskManifestSubtask {
	title: string;
	sourceIds: string[];
}

/** One complete parent task authored by the external agent. */
export interface AITaskManifestTask {
	title: string;
	description: string;
	durationMinutes: number;
	projectRoot: string;
	skills: string[];
	tools: string[];
	sourceIds: string[];
	subtasks: AITaskManifestSubtask[];
}

/** Strict JSON document written into the Vaultboard AI Tasks inbox. */
export interface AITaskManifest {
	schemaVersion: 1;
	manifestId: string;
	createdAt: string;
	actor: AITaskManifestActor;
	sources: AITaskManifestSource[];
	tasks: AITaskManifestTask[];
}

/** Result returned for an applied or already-applied manifest. */
export interface AITaskManifestIngestionResult {
	status: 'ingested' | 'unchanged';
	manifestId: string;
	manifestPath: string;
	sourceTaskIds: string[];
	taskIds: string[];
}

/** Per-file failure retained while the remaining inbox manifests continue processing. */
export interface AITaskManifestIngestionFailure {
	status: 'failed';
	manifestPath: string;
	error: string;
}

/** One result from a best-effort ordered inbox scan. */
export type AITaskManifestInboxResult = AITaskManifestIngestionResult | AITaskManifestIngestionFailure;

/** Runtime state owned by the plugin around the pure manifest parser. */
export interface AITaskManifestIngestorDependencies {
	app: App;
	taskManager: TaskManager;
	getSettings: () => PluginSettings;
	getReferences: () => LinkedReference[];
	getReceipts: () => AITaskManifestReceipt[];
	onDataChanged: () => void;
}

interface ResolvedSource {
	manifest: AITaskManifestSource;
	reference: LinkedReference;
	task: Task;
}

const ROOT_KEYS = ['schemaVersion', 'manifestId', 'createdAt', 'actor', 'sources', 'tasks'];
const ACTOR_REQUIRED_KEYS = ['sessionId', 'ai'];
const ACTOR_ALLOWED_KEYS = [...ACTOR_REQUIRED_KEYS, 'model', 'moreInfo'];
const SOURCE_KEYS = ['sourceId', 'path', 'line', 'occurrence', 'text', 'projectRoot'];
const TASK_KEYS = ['title', 'description', 'durationMinutes', 'projectRoot', 'skills', 'tools', 'sourceIds', 'subtasks'];
const SUBTASK_KEYS = ['title', 'sourceIds'];

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && Array.isArray(value) === false;

const hasExactKeys = (value: Record<string, unknown>, expected: string[]): boolean => {
	const keys = Object.keys(value).sort();
	const sortedExpected = [...expected].sort();
	return keys.length === sortedExpected.length && keys.every((key, index) => key === sortedExpected[index]);
};

const hasRequiredAndAllowedKeys = (
	value: Record<string, unknown>,
	required: string[],
	allowed: string[],
): boolean => {
	const keys = Object.keys(value);
	return required.every((key) => keys.includes(key)) && keys.every((key) => allowed.includes(key));
};

const requiredString = (value: unknown, field: string): string => {
	if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${field} must be a non-empty string.`);
	return value.trim();
};

const optionalString = (value: unknown, field: string): string | undefined => {
	if (value === undefined) return undefined;
	return requiredString(value, field);
};

const strictStringArray = (value: unknown, field: string, requireValues = false): string[] => {
	if (Array.isArray(value) === false || (requireValues && value.length === 0)) {
		throw new Error(`${field} must be ${requireValues ? 'a non-empty' : 'an'} array of strings.`);
	}
	const result = value.map((item, index) => requiredString(item, `${field}[${index}]`));
	if (new Set(result).size !== result.length) throw new Error(`${field} contains duplicate values.`);
	return result;
};

const normalizedProjectRoot = (value: string): string => {
	let normalized = value.trim().replace(/\\/g, '/');
	while (normalized.length > 1 && normalized.endsWith('/') && /^[a-zA-Z]:\/$/.test(normalized) === false) {
		normalized = normalized.slice(0, -1);
	}
	const isAbsolute = normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized);
	if (isAbsolute === false || normalized.split('/').includes('..')) {
		throw new Error('projectRoot must be an absolute path without parent traversal segments.');
	}
	return normalized;
};

const existingDirectory = (value: string, field: string): string => {
	const normalized = normalizedProjectRoot(value);
	try {
		if (statSync(normalized).isDirectory()) return normalized;
	} catch {
		// The typed error below keeps launch failures actionable without exposing system details.
	}
	throw new Error(`${field} must point to an existing directory.`);
};

const vaultPath = (value: unknown, field: string): string => {
	const raw = requiredString(value, field).replace(/\\/g, '/');
	const normalized = normalizePath(raw);
	if (normalized.startsWith('/') || normalized.split('/').includes('..')) {
		throw new Error(`${field} must be a Vault-relative path.`);
	}
	return normalized;
};

const uniqueStrings = (values: string[]): string[] => [...new Set(values)];

/** Returns the one immutable inbox folder used by external vault agents. */
export function getAITaskInboxPath(settings: PluginSettings): string {
	return normalizePath(`${settings.outputFolder || ''}/ai-tasks/inbox`);
}

/** Returns true only for direct JSON children of the configured AI Tasks inbox. */
export function isAITaskManifestPath(path: string, settings: PluginSettings): boolean {
	const normalized = normalizePath(path);
	const inbox = getAITaskInboxPath(settings);
	const separator = normalized.lastIndexOf('/');
	return separator >= 0
		&& normalized.slice(0, separator) === inbox
		&& normalized.toLowerCase().endsWith('.json');
}

/** Parses and fully validates the exact external task manifest contract. */
export function parseAITaskManifest(raw: string): AITaskManifest {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new Error('AI task manifest must contain raw valid JSON.');
	}
	if (isPlainRecord(parsed) === false || hasExactKeys(parsed, ROOT_KEYS) === false) {
		throw new Error('AI task manifest root has missing or unsupported fields.');
	}
	if (parsed.schemaVersion !== AI_TASK_MANIFEST_SCHEMA_VERSION) {
		throw new Error(`AI task manifest schemaVersion must be ${AI_TASK_MANIFEST_SCHEMA_VERSION}.`);
	}
	const manifestId = requiredString(parsed.manifestId, 'manifestId');
	if (/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(manifestId) === false) {
		throw new Error('manifestId must be a filesystem-safe identifier of at most 128 characters.');
	}
	const createdAt = requiredString(parsed.createdAt, 'createdAt');
	if (Number.isFinite(Date.parse(createdAt)) === false) throw new Error('createdAt must be a valid ISO-8601 timestamp.');

	if (
		isPlainRecord(parsed.actor) === false
		|| hasRequiredAndAllowedKeys(parsed.actor, ACTOR_REQUIRED_KEYS, ACTOR_ALLOWED_KEYS) === false
	) throw new Error('actor has missing or unsupported fields.');
	const actor: AITaskManifestActor = {
		sessionId: requiredString(parsed.actor.sessionId, 'actor.sessionId'),
		ai: requiredString(parsed.actor.ai, 'actor.ai'),
		model: optionalString(parsed.actor.model, 'actor.model'),
		moreInfo: parsed.actor.moreInfo === undefined ? undefined : vaultPath(parsed.actor.moreInfo, 'actor.moreInfo'),
	};

	if (Array.isArray(parsed.sources) === false || parsed.sources.length === 0) {
		throw new Error('sources must be a non-empty array.');
	}
	const sources = parsed.sources.map((value, index): AITaskManifestSource => {
		if (isPlainRecord(value) === false || hasExactKeys(value, SOURCE_KEYS) === false) {
			throw new Error(`sources[${index}] has missing or unsupported fields.`);
		}
		if (Number.isInteger(value.line) === false || (value.line as number) < 1) {
			throw new Error(`sources[${index}].line must be a positive integer.`);
		}
		if (Number.isInteger(value.occurrence) === false || (value.occurrence as number) < 0) {
			throw new Error(`sources[${index}].occurrence must be a non-negative integer.`);
		}
		return {
			sourceId: requiredString(value.sourceId, `sources[${index}].sourceId`),
			path: vaultPath(value.path, `sources[${index}].path`),
			line: value.line as number,
			occurrence: value.occurrence as number,
			text: requiredString(value.text, `sources[${index}].text`),
			projectRoot: normalizedProjectRoot(requiredString(value.projectRoot, `sources[${index}].projectRoot`)),
		};
	});
	const sourceIds = sources.map((source) => source.sourceId);
	if (new Set(sourceIds).size !== sourceIds.length) throw new Error('sources contains duplicate sourceId values.');
	const knownSourceIds = new Set(sourceIds);

	if (Array.isArray(parsed.tasks) === false || parsed.tasks.length === 0) throw new Error('tasks must be a non-empty array.');
	const assigned = new Set<string>();
	const tasks = parsed.tasks.map((value, taskIndex): AITaskManifestTask => {
		if (isPlainRecord(value) === false || hasExactKeys(value, TASK_KEYS) === false) {
			throw new Error(`tasks[${taskIndex}] has missing or unsupported fields.`);
		}
		if (Number.isInteger(value.durationMinutes) === false || (value.durationMinutes as number) < 1) {
			throw new Error(`tasks[${taskIndex}].durationMinutes must be a positive integer.`);
		}
		const taskSourceIds = strictStringArray(value.sourceIds, `tasks[${taskIndex}].sourceIds`, true);
		for (const sourceId of taskSourceIds) {
			if (knownSourceIds.has(sourceId) === false) throw new Error(`tasks[${taskIndex}] contains unknown sourceId ${sourceId}.`);
			if (assigned.has(sourceId)) throw new Error(`sourceId ${sourceId} is assigned to more than one task.`);
			assigned.add(sourceId);
		}
		if (Array.isArray(value.subtasks) === false || value.subtasks.length === 0) {
			throw new Error(`tasks[${taskIndex}].subtasks must be a non-empty array.`);
		}
		const grouped = new Set<string>();
		const subtasks = value.subtasks.map((subtask, subtaskIndex): AITaskManifestSubtask => {
			if (isPlainRecord(subtask) === false || hasExactKeys(subtask, SUBTASK_KEYS) === false) {
				throw new Error(`tasks[${taskIndex}].subtasks[${subtaskIndex}] has missing or unsupported fields.`);
			}
			const groupedSourceIds = strictStringArray(
				subtask.sourceIds,
				`tasks[${taskIndex}].subtasks[${subtaskIndex}].sourceIds`,
				true,
			);
			for (const sourceId of groupedSourceIds) {
				if (taskSourceIds.includes(sourceId) === false) {
					throw new Error(`Subtask sourceId ${sourceId} is not declared by its parent task.`);
				}
				if (grouped.has(sourceId)) throw new Error(`Task subtask groups assign sourceId ${sourceId} more than once.`);
				grouped.add(sourceId);
			}
			return {
				title: requiredString(subtask.title, `tasks[${taskIndex}].subtasks[${subtaskIndex}].title`),
				sourceIds: groupedSourceIds,
			};
		});
		const missingSubtaskSources = taskSourceIds.filter((sourceId) => grouped.has(sourceId) === false);
		if (missingSubtaskSources.length > 0) {
			throw new Error(`tasks[${taskIndex}] has sourceIds missing from its subtasks: ${missingSubtaskSources.join(', ')}.`);
		}
		const projectRoot = normalizedProjectRoot(requiredString(value.projectRoot, `tasks[${taskIndex}].projectRoot`));
		for (const sourceId of taskSourceIds) {
			const source = sources.find((candidate) => candidate.sourceId === sourceId);
			if (source?.projectRoot !== projectRoot) {
				throw new Error(`tasks[${taskIndex}] mixes source project roots or does not match its exact projectRoot.`);
			}
		}
		return {
			title: requiredString(value.title, `tasks[${taskIndex}].title`),
			description: requiredString(value.description, `tasks[${taskIndex}].description`),
			durationMinutes: value.durationMinutes as number,
			projectRoot,
			skills: strictStringArray(value.skills, `tasks[${taskIndex}].skills`),
			tools: strictStringArray(value.tools, `tasks[${taskIndex}].tools`),
			sourceIds: taskSourceIds,
			subtasks,
		};
	});
	const omitted = sourceIds.filter((sourceId) => assigned.has(sourceId) === false);
	if (omitted.length > 0) throw new Error(`Manifest sources are not assigned to tasks: ${omitted.join(', ')}.`);
	return { schemaVersion: 1, manifestId, createdAt, actor, sources, tasks };
}

/** Builds a complete execution handoff from per-task external attribution only. */
export function composeAITaskExecutionPrompt(task: Task, settings: PluginSettings, vaultRoot: string): string {
	const attribution = task.aiAttribution;
	if (attribution === undefined) throw new Error('Only externally authored AI tasks have an execution prompt.');
	const projectRoot = existingDirectory(task.workingDirectory ?? '', 'Project root');
	const normalizedVaultRoot = existingDirectory(vaultRoot, 'Vault root');
	const skills = uniqueStrings([...settings.aiTaskSkills, ...attribution.skills]);
	const tools = uniqueStrings([...settings.aiTaskTools, ...attribution.tools]);
	const lines = task.subtasks?.flatMap((subtask) => formatSubtask(subtask, 0)) ?? ['- None'];
	return [
		'# Vaultboard AI Task Execution',
		'',
		`Task: ${task.title}`,
		`Description: ${task.description?.trim() || 'No description provided.'}`,
		`Project root: ${projectRoot}`,
		`Vault root: ${normalizedVaultRoot}`,
		'',
		'Work groups and source TODOs:',
		...lines,
		'',
		'External attribution:',
		`- Manifest ID: ${attribution.manifestId}`,
		`- Manifest path: ${attribution.manifestPath}`,
		`- Session ID: ${attribution.sessionId}`,
		`- Agent/model: ${attribution.agent}/${attribution.model || 'agent-default'}`,
		`- More info: ${attribution.moreInfo || 'None'}`,
		`- Source task IDs: ${attribution.sourceTaskIds.join(', ')}`,
		`- Source reference IDs: ${attribution.sourceReferenceIds.join(', ') || 'None'}`,
		`- Source paths: ${attribution.sourcePaths.join(', ') || 'None'}`,
		`- Assigned skills: ${skills.join(', ') || 'None'}`,
		`- Assigned tools: ${tools.join(', ') || 'None'}`,
		'',
		'Before editing, resolve the Vault-relative manifest, more-info reference, and source paths against the Vault root and inspect each one.',
		'Implement the complete task within the exact project root while respecting the assigned skills and tools.',
		'Run appropriate verification and report concrete evidence for every nested source TODO.',
	].join('\n');
}

/** Ingests strict external manifests without invoking Vaultboard AI dispatch providers. */
export class AITaskManifestIngestor {
	private dependencies: AITaskManifestIngestorDependencies;

	constructor(dependencies: AITaskManifestIngestorDependencies) {
		this.dependencies = dependencies;
	}

	/** Reads and applies one direct inbox manifest. */
	async ingestFile(file: TFile): Promise<AITaskManifestIngestionResult> {
		const settings = this.dependencies.getSettings();
		if (isAITaskManifestPath(file.path, settings) === false) {
			throw new Error(`${file.path} is not a JSON file in ${getAITaskInboxPath(settings)}.`);
		}
		const raw = await this.dependencies.app.vault.cachedRead(file);
		return this.ingest(file.path, raw);
	}

	/** Applies every currently present inbox manifest in path order. */
	async ingestInbox(): Promise<AITaskManifestInboxResult[]> {
		const settings = this.dependencies.getSettings();
		const files = this.dependencies.app.vault.getFiles()
			.filter((file) => isAITaskManifestPath(file.path, settings))
			.sort((first, second) => first.path.localeCompare(second.path));
		const results: AITaskManifestInboxResult[] = [];
		for (const file of files) {
			try {
				results.push(await this.ingestFile(file));
			} catch (error) {
				results.push({
					status: 'failed',
					manifestPath: file.path,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}
		return results;
	}

	/** Applies validated JSON content; exposed separately for deterministic tests. */
	ingest(manifestPath: string, raw: string): AITaskManifestIngestionResult {
		const normalizedManifestPath = normalizePath(manifestPath);
		if (isAITaskManifestPath(normalizedManifestPath, this.dependencies.getSettings()) === false) {
			throw new Error(`${normalizedManifestPath} is outside the AI Tasks inbox.`);
		}
		const manifest = parseAITaskManifest(raw);
		const expectedPath = normalizePath(`${getAITaskInboxPath(this.dependencies.getSettings())}/${manifest.manifestId}.json`);
		if (normalizedManifestPath !== expectedPath) {
			throw new Error(`AI task manifest filename must be ${manifest.manifestId}.json.`);
		}
		const fingerprint = manifestFingerprint(manifest);
		const receipts = this.dependencies.getReceipts();
		const receiptById = receipts.find((receipt) => receipt.manifestId === manifest.manifestId);
		const receiptByPath = receipts.find((receipt) => normalizePath(receipt.manifestPath) === normalizedManifestPath);
		if (receiptById !== undefined || receiptByPath !== undefined) {
			if (
				receiptById !== undefined
				&& receiptByPath === receiptById
				&& receiptById.fingerprint === fingerprint
			) {
				return {
					status: 'unchanged',
					manifestId: receiptById.manifestId,
					manifestPath: receiptById.manifestPath,
					sourceTaskIds: [...receiptById.sourceTaskIds],
					taskIds: [...receiptById.taskIds],
				};
			}
			throw new Error('AI task manifest conflicts with an already ingested manifest ID or path; overwrites are not allowed.');
		}

		const resolved = this.resolveSources(manifest);
		const sourceTaskIds = resolved.map(({ task }) => task.id);
		const resolvedBySourceId = new Map(resolved.map((source) => [source.manifest.sourceId, source]));
		const references = this.dependencies.getReferences();
		const taskIds: string[] = [];
		const createdAt = Date.parse(manifest.createdAt);

		for (let taskIndex = 0; taskIndex < manifest.tasks.length; taskIndex += 1) {
			const authoredTask = manifest.tasks[taskIndex];
			const themedSources = authoredTask.sourceIds.map((sourceId) => resolvedBySourceId.get(sourceId) as ResolvedSource);
			const survivor = themedSources[0].task;
			const themeTaskIds = themedSources.map(({ task }) => task.id);
			const themeReferences = references.filter((reference) => themeTaskIds.includes(reference.targetId));
			const attribution: AITaskAttribution = {
				manifestId: manifest.manifestId,
				manifestPath: normalizedManifestPath,
				sessionId: manifest.actor.sessionId,
				agent: manifest.actor.ai,
				model: manifest.actor.model ?? '',
				createdAt,
				moreInfo: manifest.actor.moreInfo,
				sourceTaskIds: themeTaskIds,
				sourceReferenceIds: uniqueStrings(themedSources.map(({ reference }) => reference.id)),
				sourcePaths: uniqueStrings(themedSources.map(({ reference }) => normalizePath(reference.sourcePath))),
				skills: [...authoredTask.skills],
				tools: [...authoredTask.tools],
			};
			const merged = this.dependencies.taskManager.mergeTasks(
				survivor.id,
				themeTaskIds.slice(1),
				{
					title: authoredTask.title,
					description: authoredTask.description,
					durationMinutes: authoredTask.durationMinutes,
					subtasks: authoredTask.subtasks.map((group, groupIndex) => ({
						id: `ai-group-${safeId(manifest.manifestId)}-${taskIndex}-${groupIndex}`,
						title: group.title,
						status: 'pending',
						subtasks: group.sourceIds.map((sourceId) => sourceTaskToSubtask((resolvedBySourceId.get(sourceId) as ResolvedSource).task)),
					})),
					tags: uniqueStrings(themedSources.flatMap(({ task }) => task.tags ?? [])),
					linkedDocs: uniqueStrings(themedSources.flatMap(({ task }) => task.linkedDocs ?? [])),
					images: uniqueStrings(themedSources.flatMap(({ task }) => task.images ?? [])),
					workingDirectory: authoredTask.projectRoot,
					categoryId: AI_TASKS_CATEGORY_ID,
					aiAttribution: attribution,
				},
			);
			if (merged === undefined) throw new Error(`Could not merge external AI task ${authoredTask.title}.`);
			taskIds.push(merged.id);
			for (const reference of themeReferences) reference.targetId = merged.id;
		}

		receipts.push({
			manifestId: manifest.manifestId,
			manifestPath: normalizedManifestPath,
			fingerprint,
			ingestedAt: Date.now(),
			sourceTaskIds,
			taskIds,
		});
		this.dependencies.taskManager.clearUndoHistory();
		this.dependencies.onDataChanged();
		return { status: 'ingested', manifestId: manifest.manifestId, manifestPath: normalizedManifestPath, sourceTaskIds, taskIds };
	}

	private resolveSources(manifest: AITaskManifest): ResolvedSource[] {
		const references = this.dependencies.getReferences();
		const seenTargetIds = new Set<string>();
		return manifest.sources.map((source) => {
			const matches = references.filter((reference) =>
				reference.state === 'active'
				&& normalizePath(reference.sourcePath) === source.path
				&& reference.sourceLine === source.line
				&& reference.sourceOccurrence === source.occurrence
				&& reference.sourceText === source.text,
			);
			if (matches.length !== 1) {
				throw new Error(`Source ${source.sourceId} must match exactly one active canonical TODO reference.`);
			}
			const reference = matches[0];
			const task = this.dependencies.taskManager.getTask(reference.targetId);
			if (
				task === undefined
				|| task.categoryId !== AI_TASKS_CATEGORY_ID
				|| task.status !== 'pending'
				|| task.aiAttribution !== undefined
			) throw new Error(`Source ${source.sourceId} does not target an available pending AI Tasks TODO.`);
			if (seenTargetIds.has(task.id)) throw new Error(`Multiple manifest sources resolve to task ${task.id}.`);
			seenTargetIds.add(task.id);
			const existingRoot = task.workingDirectory === undefined ? undefined : normalizedProjectRoot(task.workingDirectory);
			if (existingRoot !== undefined && existingRoot !== source.projectRoot) {
				throw new Error(`Source ${source.sourceId} conflicts with its task's configured project root.`);
			}
			return { manifest: source, reference, task };
		});
	}
}

const formatSubtask = (subtask: SubTask, depth: number): string[] => {
	const marker = subtask.status === 'completed' ? 'x' : ' ';
	const line = `${'  '.repeat(depth)}- [${marker}] ${subtask.title}`;
	return [line, ...(subtask.subtasks?.flatMap((child) => formatSubtask(child, depth + 1)) ?? [])];
};

const cloneSubtasks = (subtasks: SubTask[] | undefined): SubTask[] | undefined => subtasks?.map((subtask) => ({
	...subtask,
	subtasks: cloneSubtasks(subtask.subtasks),
}));

const sourceTaskToSubtask = (task: Task): SubTask => ({
	id: `ai-source-${task.id}`,
	title: task.title,
	status: task.status === 'completed' ? 'completed' : 'pending',
	subtasks: cloneSubtasks(task.subtasks),
});

const safeId = (value: string): string => value.replace(/[^a-zA-Z0-9_-]/g, '-');

/** Stable lightweight fingerprint used only for immutable overwrite detection. */
const manifestFingerprint = (manifest: AITaskManifest): string => {
	const input = JSON.stringify(manifest);
	let hash = 0x811c9dc5;
	for (let index = 0; index < input.length; index += 1) {
		hash ^= input.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
};
