/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard
 * Description: Shared formatting utilities for tasks and subtasks (clipboard copy, export)
 * Created: 2026-03-13
 * Last Modified: 2026-03-13
 */

import type { Task, SubTask } from './types';

/** Shared formatting utilities for tasks and subtasks. */
export class TaskFormatter {
	/** Formats an array of tasks as a markdown checklist string. */
	static formatTasks(tasks: Task[]): string {
		const lines: string[] = [];
		for (const task of tasks) {
			const check = task.status === 'completed' ? 'x' : task.status === 'skipped' ? '-' : ' ';
			const planned = TaskFormatter.formatDuration(task.durationMinutes);
			const tags = task.tags?.length ? ` [${task.tags.join(', ')}]` : '';
			const actual = task.actualDurationMinutes !== null && task.actualDurationMinutes !== undefined
				? ` | actual: ${TaskFormatter.formatDuration(task.actualDurationMinutes)}`
				: '';
			lines.push(`- [${check}] ${task.title} (${planned}${actual})${tags}`);
			if (task.description) {
				lines.push(`  ${task.description}`);
			}
			if (task.startedAt) {
				lines.push(`  Started: ${new Date(task.startedAt).toLocaleString()}`);
			}
			if (task.completedAt) {
				lines.push(`  Completed: ${new Date(task.completedAt).toLocaleString()}`);
			}
			if (task.linkedDocs?.length) {
				lines.push(`  Linked: ${task.linkedDocs.join(', ')}`);
			}
			if (task.images?.length) {
				lines.push(`  Images: ${task.images.join(', ')}`);
			}
			if (task.delegationStatus) {
				lines.push(`  Delegation: ${task.delegationStatus}`);
			}
			if (task.delegationFeedback) {
				lines.push(`  Feedback: ${task.delegationFeedback}`);
			}
			if (task.subtasks?.length) {
				lines.push(TaskFormatter.formatSubtasks(task.subtasks, 1));
			}
		}
		return lines.join('\n');
	}

	/** Formats subtasks as indented markdown checklist lines. */
	static formatSubtasks(subtasks: SubTask[], depth = 0): string {
		const lines: string[] = [];
		const indent = '  '.repeat(depth);
		for (const sub of subtasks) {
			const check = sub.status === 'completed' ? 'x' : ' ';
			lines.push(`${indent}- [${check}] ${sub.title}`);
			if (sub.subtasks?.length) {
				lines.push(TaskFormatter.formatSubtasks(sub.subtasks, depth + 1));
			}
		}
		return lines.join('\n');
	}

	/** Formats minutes as HH:MM:00. */
	static formatDuration(minutes: number): string {
		const h = Math.floor(minutes / 60);
		const m = minutes % 60;
		return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
	}
}
