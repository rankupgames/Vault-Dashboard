/*
 * Author: Miguel A. Lopez
 * Edited By: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard Welcome
 * Description: Scans note checklists and extracts importable task items with nested subtasks
 * Created: 2026-03-08
 * Last Modified: 2026-03-13
 */

import { App, TFile } from 'obsidian';
import type { SubTask } from '../core/types';
import { TaskParser } from './TaskParser';

/** A scanned checklist item with optional subtasks for import. */
export interface TaskImportItem {
	/** Task title. */
	title: string;
	/** Nested subtasks. */
	subtasks: SubTask[];
	/** 1-based line number in source. */
	line: number;
	/** Whether selected for import. */
	selected: boolean;
}

/** Scans note checklists and extracts importable task items with nested subtasks. */
export class TaskImporter {
	/** Parses a note and returns importable task items from checklist lines. */
	static async scanNote(app: App, file: TFile): Promise<TaskImportItem[]> {
		const content = await app.vault.read(file);
		const lines = content.split('\n');
		const parsed = TaskParser.parseLines(lines);

		const items: TaskImportItem[] = [];
		let lineIdx = 0;
		for (const entry of parsed) {
			const foundAt = lines.findIndex((l, i) => i >= lineIdx && l.includes(entry.title));
			const line = foundAt >= 0 ? foundAt + 1 : lineIdx + 1;
			if (foundAt >= 0) lineIdx = foundAt + 1;

			items.push({
				title: entry.title,
				subtasks: entry.subtasks,
				line,
				selected: true,
			});
		}

		return items;
	}
}
