import { App, TFile } from 'obsidian';
import type { Task } from '../../core/types';
import { TaskManager } from '../../core/TaskManager';
import type { AIAction } from './AIAction';
import type { AIContext } from './AIContext';

/** Provider-facing instructions for each supported task action. */
const ACTION_INSTRUCTIONS: Record<AIAction, string> = {
	organize: 'Analyze this task and suggest appropriate tags and timeline position relative to the other tasks. Return a JSON object with { tags: string[], insertAfterTaskId: string | null }.',
	order: 'Reorder these pending tasks by priority, dependency, and logical flow. Return a JSON array of task IDs in the optimal order.',
	'create-doc': 'Create a comprehensive document for this task based on the provided context. Output the document content in markdown format.',
	delegate: 'Execute the following task. The description below is your primary instruction.',
};

/** Review-only instruction used during delegate plan generation. */
const PLAN_PHASE_INSTRUCTION = 'Analyze this task and produce a detailed step-by-step execution plan. Describe exactly what you will do, which files you will touch, and the expected outcome. Do NOT execute anything yet -- only output the plan.';

/** Prefix that turns an approved plan into an execution prompt. */
export const EXECUTE_PHASE_PREFIX = 'The user has reviewed and approved the following execution plan. Proceed to execute it exactly as described.\n\n## Approved Plan\n';

/**
 * Reads tasks, linked notes, and referenced image paths into one prompt context.
 * Linked notes are read once even when multiple tasks reference the same path.
 */
export const gatherContext = async (taskManager: TaskManager, app: App): Promise<AIContext> => {
	const tasks = taskManager.toJSON();
	const archivedTasks = taskManager.getArchivedTasks();
	const allTasks = [...tasks, ...archivedTasks];
	const linkedDocContents = new Map<string, string>();
	const seenPaths = new Set<string>();

	for (const task of allTasks) {
		for (const documentPath of task.linkedDocs ?? []) {
			if (seenPaths.has(documentPath)) continue;
			seenPaths.add(documentPath);
			const file = app.vault.getAbstractFileByPath(documentPath);
			if (file instanceof TFile) {
				const content = await app.vault.cachedRead(file);
				linkedDocContents.set(documentPath, content);
			}
		}
	}

	const imagePaths: string[] = [];
	for (const task of allTasks) {
		for (const imagePath of task.images ?? []) {
			if (imagePaths.includes(imagePath) === false) {
				imagePaths.push(imagePath);
			}
		}
	}

	return { tasks, archivedTasks, linkedDocContents, imagePaths };
};

/**
 * Composes the stable markdown context layout shared by normal and plan prompts.
 * The optional instruction override changes only the action guidance at the top.
 */
const composePromptWithInstruction = (
	action: AIAction,
	context: AIContext,
	focusTask: Task | undefined,
	instruction: string,
): string => {
	const lines: string[] = [];
	lines.push(`# AI Task Action: ${action}`);
	lines.push('');
	lines.push(instruction);
	lines.push('');

	if (focusTask) {
		lines.push('## Focus Task');
		lines.push(`- **Title**: ${focusTask.title}`);
		if (focusTask.description) {
			lines.push(`- **Description**: ${focusTask.description}`);
		}
		lines.push(`- **Duration**: ${focusTask.durationMinutes}m`);
		lines.push(`- **Status**: ${focusTask.status}`);
		if (focusTask.tags && focusTask.tags.length > 0) {
			lines.push(`- **Tags**: ${focusTask.tags.join(', ')}`);
		}
		if (focusTask.subtasks && focusTask.subtasks.length > 0) {
			lines.push(`- **Subtasks**: ${focusTask.subtasks.map((subtask) => `${subtask.status === 'completed' ? '[x]' : '[ ]'} ${subtask.title}`).join('; ')}`);
		}
		lines.push('');
	}

	lines.push('## All Tasks');
	for (const task of context.tasks) {
		const marker = task.id === focusTask?.id ? ' **(FOCUS)**' : '';
		lines.push(`- [${task.status}] ${task.title} (${task.durationMinutes}m)${marker}${task.tags?.length ? ` [${task.tags.join(', ')}]` : ''}`);
		if (task.description) lines.push(`  Description: ${task.description}`);
	}
	lines.push('');

	if (context.archivedTasks.length > 0) {
		lines.push('## Archived Tasks');
		for (const task of context.archivedTasks) {
			lines.push(`- ${task.title} (${task.durationMinutes}m)${task.tags?.length ? ` [${task.tags.join(', ')}]` : ''}`);
		}
		lines.push('');
	}

	if (context.linkedDocContents.size > 0) {
		lines.push('## Linked Document Contents');
		for (const [path, content] of context.linkedDocContents) {
			lines.push(`### ${path}`);
			lines.push('```');
			const truncated = content.length > 3000 ? content.substring(0, 3000) + '\n... (truncated)' : content;
			lines.push(truncated);
			lines.push('```');
			lines.push('');
		}
	}

	if (context.imagePaths.length > 0) {
		lines.push('## Attached Images');
		for (const imagePath of context.imagePaths) {
			lines.push(`- ${imagePath}`);
		}
		lines.push('');
	}

	return lines.join('\n');
};

/** Composes a markdown prompt for a task action and optional focus task. */
export const composePrompt = (action: AIAction, context: AIContext, focusTask?: Task): string =>
	composePromptWithInstruction(action, context, focusTask, ACTION_INSTRUCTIONS[action]);

/** Composes a delegate prompt constrained to review-only plan generation. */
export const composePlanPrompt = (context: AIContext, focusTask: Task): string =>
	composePromptWithInstruction('delegate', context, focusTask, PLAN_PHASE_INSTRUCTION);

/** Converts a task title into the filename-safe dispatch folder segment used by prompt notes. */
export const toPromptSlug = (value: string): string =>
	value.substring(0, 60).replace(/[\\/:*?"<>|#^[\]]/g, '-').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'untitled';
