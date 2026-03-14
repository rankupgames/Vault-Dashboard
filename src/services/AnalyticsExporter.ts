/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard
 * Description: Export task analytics to CSV or append to daily note
 * Created: 2026-03-08
 * Last Modified: 2026-03-08
 */

import { App, TFile } from 'obsidian';
import { Task } from '../core/types';

/** Escapes a string for safe CSV cell output (prevents formula injection). */
const escapeCSV = (val: string): string => {
	const escaped = val.replace(/"/g, '""');
	const needsPrefix = /^[=+\-@\t\r]/.test(escaped);
	return `"${needsPrefix ? '\'' : ''}${escaped}"`;
};

/** Exports task analytics to CSV or appends to daily note. */
export class AnalyticsExporter {
	/** Returns CSV string for tasks and archived tasks. */
	static exportToCSV(tasks: Task[], archivedTasks: Task[]): string {
		const all = [...tasks, ...archivedTasks];
		const header = 'Title,Tags,Estimated (min),Actual (min),Status,Started,Completed';
		const rows = all.map((t) => {
			const tags = t.tags?.join('; ') ?? '';
			const est = String(t.durationMinutes);
			const act = t.actualDurationMinutes !== undefined ? String(t.actualDurationMinutes) : '';
			const started = t.startedAt ? new Date(t.startedAt).toISOString() : '';
			const completed = t.completedAt ? new Date(t.completedAt).toISOString() : '';
			return `${escapeCSV(t.title)},${escapeCSV(tags)},${est},${act},${t.status},${started},${completed}`;
		});
		return [header, ...rows].join('\n');
	}

	/** Appends completed task summary to today's daily note. */
	static async exportToDailyNote(app: App, tasks: Task[], dailyNotesFolder = '_DailyNotes'): Promise<void> {
		const today = new Date();
		const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
		const folder = dailyNotesFolder.replace(/\/+$/, '');
		const notePath = `${folder}/${dateStr}.md`;

		const completed = tasks.filter((t) => t.status === 'completed');
		if (completed.length === 0) return;

		const totalMin = completed.reduce((s, t) => s + (t.actualDurationMinutes ?? t.durationMinutes), 0);
		const h = Math.floor(totalMin / 60);
		const m = totalMin % 60;

		const lines = [
			'',
			'## Task Summary',
			`- **Completed**: ${completed.length} task${completed.length !== 1 ? 's' : ''}`,
			`- **Total Time**: ${h > 0 ? `${h}h ` : ''}${m}m`,
			'',
			...completed.map((t) => {
				const est = `${t.durationMinutes}m`;
				const act = t.actualDurationMinutes !== undefined ? `${t.actualDurationMinutes}m` : est;
				const tagStr = t.tags && t.tags.length > 0 ? ` [${t.tags.join(', ')}]` : '';
				return `- [x] ${t.title} (est ${est} / actual ${act})${tagStr}`;
			}),
		];

		const existing = app.vault.getAbstractFileByPath(notePath);
		if (existing instanceof TFile) {
			const content = await app.vault.read(existing);
			await app.vault.modify(existing, content + '\n' + lines.join('\n'));
		} else {
			await app.vault.create(notePath, `# ${dateStr}\n` + lines.join('\n'));
		}
	}

	/** Triggers browser download of the CSV with the given filename. */
	static downloadCSV(csv: string, filename: string): void {
		const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = filename;
		link.click();
		URL.revokeObjectURL(url);
	}
}
