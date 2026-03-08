/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard Welcome
 * Description: Scans note checklists and extracts importable task items with nested subtasks
 * Created: 2026-03-08
 * Last Modified: 2026-03-08
 */

import { App, TFile } from 'obsidian';
import { SubTask } from '../types';

export interface TaskImportItem {
	title: string;
	subtasks: SubTask[];
	line: number;
	selected: boolean;
}

export class TaskImporter {
	static async scanNote(app: App, file: TFile): Promise<TaskImportItem[]> {
		const content = await app.vault.read(file);
		const lines = content.split('\n');
		const items: TaskImportItem[] = [];

		let currentParent: TaskImportItem | null = null;
		let parentIndent = -1;

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const match = line.match(/^(\s*)- \[( |x)\]\s+(.+)/);
			if (match === null) {
				currentParent = null;
				parentIndent = -1;
				continue;
			}

			const indent = match[1].length;
			const title = match[3].trim();

			if (indent === 0 || currentParent === null || indent <= parentIndent) {
				const item: TaskImportItem = {
					title,
					subtasks: [],
					line: i + 1,
					selected: true,
				};
				items.push(item);
				currentParent = item;
				parentIndent = indent;
			} else {
				currentParent.subtasks.push({
					id: `imp_${Date.now().toString(36)}${Math.random().toString(36).substring(2, 6)}`,
					title,
					status: 'pending',
				});
			}
		}

		return items;
	}
}
