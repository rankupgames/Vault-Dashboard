/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard Welcome
 * Description: Snapshot-based undo/redo stack for task mutations
 * Created: 2026-03-08
 * Last Modified: 2026-03-08
 */

import { Task } from './types';

export interface UndoSnapshot {
	tasks: Task[];
	archivedTasks: Task[];
}

const MAX_STACK = 20;

export class UndoManager {
	private undoStack: UndoSnapshot[] = [];
	private redoStack: UndoSnapshot[] = [];

	push(snapshot: UndoSnapshot): void {
		this.undoStack.push({
			tasks: JSON.parse(JSON.stringify(snapshot.tasks)),
			archivedTasks: JSON.parse(JSON.stringify(snapshot.archivedTasks)),
		});
		if (this.undoStack.length > MAX_STACK) {
			this.undoStack.shift();
		}
		this.redoStack = [];
	}

	canUndo(): boolean {
		return this.undoStack.length > 0;
	}

	canRedo(): boolean {
		return this.redoStack.length > 0;
	}

	undo(current: UndoSnapshot): UndoSnapshot | undefined {
		const snapshot = this.undoStack.pop();
		if (snapshot === undefined) return undefined;
		this.redoStack.push({
			tasks: JSON.parse(JSON.stringify(current.tasks)),
			archivedTasks: JSON.parse(JSON.stringify(current.archivedTasks)),
		});
		return snapshot;
	}

	redo(current: UndoSnapshot): UndoSnapshot | undefined {
		const snapshot = this.redoStack.pop();
		if (snapshot === undefined) return undefined;
		this.undoStack.push({
			tasks: JSON.parse(JSON.stringify(current.tasks)),
			archivedTasks: JSON.parse(JSON.stringify(current.archivedTasks)),
		});
		return snapshot;
	}
}
