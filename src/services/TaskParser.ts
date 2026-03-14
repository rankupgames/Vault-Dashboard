/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard
 * Description: Pure utility for parsing checklist text into structured SubTask trees
 * Created: 2026-03-13
 * Last Modified: 2026-03-13
 */

import type { SubTask } from '../core/types';

/** A top-level checklist item parsed from text with nested subtasks. */
export interface ParsedChecklistItem {
	/** Item title text. */
	title: string;
	/** Completion status derived from the checkbox marker. */
	status: 'pending' | 'completed';
	/** Nested subtasks built from indented children. */
	subtasks: SubTask[];
}

const CHECKLIST_RE = /^(\s*)- \[( |x)\]\s+(.+)/;

const makeId = (): string =>
	`p_${Date.now().toString(36)}${Math.random().toString(36).substring(2, 6)}`;

/**
 * Pure utility for parsing checklist text lines into structured task/subtask trees.
 * Used by both TaskImporter (file-based) and the clipboard DropZone (text-based).
 */
export class TaskParser {
	/**
	 * Parses an array of text lines into top-level checklist items
	 * with properly nested SubTask trees based on indentation.
	 */
	static parseLines(lines: string[]): ParsedChecklistItem[] {
		const items: ParsedChecklistItem[] = [];

		type StackEntry = { indent: number; children: SubTask[] };
		let stack: StackEntry[] = [];
		let currentItem: ParsedChecklistItem | null = null;

		for (const line of lines) {
			const match = line.match(CHECKLIST_RE);
			if (match === null) {
				currentItem = null;
				stack = [];
				continue;
			}

			const indent = match[1].length;
			const status: 'pending' | 'completed' = match[2] === 'x' ? 'completed' : 'pending';
			const title = match[3].trim();

			if (indent === 0 || currentItem === null) {
				currentItem = { title, status, subtasks: [] };
				items.push(currentItem);
				stack = [{ indent, children: currentItem.subtasks }];
				continue;
			}

			const sub: SubTask = { id: makeId(), title, status };

			const top = stack[stack.length - 1];
			if (indent > top.indent) {
				top.children.push(sub);
				stack.push({ indent, children: [] });
				const parent = top.children[top.children.length - 1];
				if (parent.subtasks === undefined) parent.subtasks = [];
				stack[stack.length - 1].children = parent.subtasks;
			} else if (indent === top.indent) {
				if (stack.length >= 2) {
					stack[stack.length - 2].children.push(sub);
					if (sub.subtasks === undefined) sub.subtasks = [];
					stack[stack.length - 1] = { indent, children: sub.subtasks };
				} else {
					top.children.push(sub);
				}
			} else {
				while (stack.length > 1 && stack[stack.length - 1].indent > indent) {
					stack.pop();
				}
				const target = stack.length >= 2 ? stack[stack.length - 2] : stack[stack.length - 1];
				target.children.push(sub);
				if (sub.subtasks === undefined) sub.subtasks = [];
				if (stack.length > 0 && stack[stack.length - 1].indent !== indent) {
					stack.push({ indent, children: sub.subtasks });
				} else {
					stack[stack.length - 1] = { indent, children: sub.subtasks };
				}
			}
		}

		return items;
	}
}
