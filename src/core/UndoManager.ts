/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard Welcome
 * Description: Generic snapshot-based undo/redo stack
 * Created: 2026-03-08
 * Last Modified: 2026-03-09
 */

const MAX_STACK = 20;

/** Generic snapshot-based undo/redo stack. */
export class UndoManager<T> {
	private undoStack: T[] = [];
	private redoStack: T[] = [];
	private cloneFn: (snapshot: T) => T;

	constructor(cloneFn?: (snapshot: T) => T) {
		this.cloneFn = cloneFn ?? ((s) => JSON.parse(JSON.stringify(s)));
	}

	/** Pushes a snapshot onto the undo stack and clears redo. */
	push(snapshot: T): void {
		this.undoStack.push(this.cloneFn(snapshot));
		if (this.undoStack.length > MAX_STACK) {
			this.undoStack.shift();
		}
		this.redoStack = [];
	}

	/** Returns true if undo is available. */
	canUndo(): boolean {
		return this.undoStack.length > 0;
	}

	/** Returns true if redo is available. */
	canRedo(): boolean {
		return this.redoStack.length > 0;
	}

	/**
	 * Pops the previous snapshot and pushes current onto redo.
	 * @param current - Current state to save for redo
	 * @returns Previous snapshot, or undefined if stack empty
	 */
	undo(current: T): T | undefined {
		const snapshot = this.undoStack.pop();
		if (snapshot === undefined) return undefined;
		this.redoStack.push(this.cloneFn(current));
		return snapshot;
	}

	/**
	 * Pops the next snapshot and pushes current onto undo.
	 * @param current - Current state to save for undo
	 * @returns Next snapshot, or undefined if stack empty
	 */
	redo(current: T): T | undefined {
		const snapshot = this.redoStack.pop();
		if (snapshot === undefined) return undefined;
		this.undoStack.push(this.cloneFn(current));
		return snapshot;
	}
}
