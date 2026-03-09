/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard Welcome
 * Description: AI context assembler and terminal dispatcher for Cursor/Claude Code CLI
 * Created: 2026-03-08
 * Last Modified: 2026-03-08
 */

import { App, TFile, normalizePath, Notice } from 'obsidian';
import { Task, PluginSettings } from '../types';
import { TaskManager } from '../TaskManager';

export type AIAction =
	| 'organize'
	| 'order'
	| 'create-doc'
	| 'schedule'
	| 'delegate';

interface AIContext {
	tasks: Task[];
	archivedTasks: Task[];
	linkedDocContents: Map<string, string>;
	imagePaths: string[];
}

const ACTION_INSTRUCTIONS: Record<AIAction, string> = {
	organize: 'Analyze this task and suggest appropriate tags and timeline position relative to the other tasks. Return a JSON object with { tags: string[], insertAfterTaskId: string | null }.',
	order: 'Reorder these pending tasks by priority, dependency, and logical flow. Return a JSON array of task IDs in the optimal order.',
	'create-doc': 'Create a comprehensive document for this task based on the provided context. Output the document content in markdown format.',
	schedule: 'Estimate durations for tasks that lack them and optimize existing durations based on task complexity. Return a JSON array of { taskId: string, durationMinutes: number }.',
	delegate: 'Execute the following task. The description below is your primary instruction.',
};

export class AIDispatcher {

	static isEnabled(settings: PluginSettings): boolean {
		return settings.aiTool !== 'none';
	}

	static async gatherContext(taskManager: TaskManager, app: App): Promise<AIContext> {
		const tasks = taskManager.toJSON();
		const archivedTasks = taskManager.getArchivedTasks();

		const linkedDocContents = new Map<string, string>();
		const allTasks = [...tasks, ...archivedTasks];
		const seenPaths = new Set<string>();

		for (const task of allTasks) {
			for (const docPath of task.linkedDocs ?? []) {
				if (seenPaths.has(docPath)) continue;
				seenPaths.add(docPath);
				const file = app.vault.getAbstractFileByPath(docPath);
				if (file instanceof TFile) {
					const content = await app.vault.cachedRead(file);
					linkedDocContents.set(docPath, content);
				}
			}
		}

		const imagePaths: string[] = [];
		for (const task of allTasks) {
			for (const imgPath of task.images ?? []) {
				if (imagePaths.includes(imgPath) === false) {
					imagePaths.push(imgPath);
				}
			}
		}

		return { tasks, archivedTasks, linkedDocContents, imagePaths };
	}

	static composePrompt(action: AIAction, context: AIContext, focusTask?: Task): string {
		const lines: string[] = [];
		lines.push(`# AI Task Action: ${action}`);
		lines.push('');
		lines.push(ACTION_INSTRUCTIONS[action]);
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
				lines.push(`- **Subtasks**: ${focusTask.subtasks.map((s) => `${s.status === 'completed' ? '[x]' : '[ ]'} ${s.title}`).join('; ')}`);
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
			for (const imgPath of context.imagePaths) {
				lines.push(`- ${imgPath}`);
			}
			lines.push('');
		}

		return lines.join('\n');
	}

	static async dispatch(app: App, settings: PluginSettings, prompt: string): Promise<void> {
		if (settings.aiTool === 'none') {
			new Notice('No AI tool configured. Set one in Settings > AI.');
			return;
		}

		const tempPath = normalizePath('_vault-welcome-ai-prompt.md');
		const existing = app.vault.getAbstractFileByPath(tempPath);
		if (existing instanceof TFile) {
			await app.vault.modify(existing, prompt);
		} else {
			await app.vault.create(tempPath, prompt);
		}

		const vaultPath = (app.vault.adapter as { basePath?: string }).basePath ?? '';
		const promptFile = `${vaultPath}/${tempPath}`;

		let command: string;
		const toolPath = settings.aiToolPath || settings.aiTool;

		if (settings.aiTool === 'cursor') {
			command = `${toolPath} --message "$(cat '${promptFile}')"`;
		} else {
			command = `${toolPath} --print "$(cat '${promptFile}')"`;
		}

		new Notice(`AI dispatch: running ${settings.aiTool}...`);

		const { exec } = require('child_process') as typeof import('child_process');
		exec(command, { cwd: vaultPath, maxBuffer: 1024 * 1024 * 5 }, (error, stdout, stderr) => {
			if (error) {
				new Notice(`AI dispatch error: ${error.message}`);
				console.error('[AIDispatcher]', error);
				return;
			}
			if (stderr) {
				console.warn('[AIDispatcher] stderr:', stderr);
			}
			if (stdout) {
				new Notice('AI dispatch complete. Check output in terminal.');
				console.log('[AIDispatcher] stdout:', stdout);
			}
		});
	}
}
