/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vaultboard
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
	/** Completion status in the source note. */
	status: 'pending' | 'completed';
	/** Zero-based occurrence among identical top-level checklist titles. */
	occurrence: number;
	/** Whether selected for import. */
	selected: boolean;
}

/** Scans note checklists and extracts importable task items with nested subtasks. */
export class TaskImporter {
	/** Parses a note and returns importable task items from checklist lines. */
	static async scanNote(app: App, file: TFile): Promise<TaskImportItem[]> {
		const content = await app.vault.read(file);
		const parsed = TaskParser.parseLines(content.split('\n'));

		const items: TaskImportItem[] = [];
		const occurrences = new Map<string, number>();
		for (const entry of parsed) {
			const occurrence = occurrences.get(entry.title) ?? 0;
			occurrences.set(entry.title, occurrence + 1);

			items.push({
				title: entry.title,
				subtasks: entry.subtasks,
				line: entry.line,
				status: entry.status,
				occurrence,
				selected: entry.status === 'pending',
			});
		}

		return items;
	}
}
