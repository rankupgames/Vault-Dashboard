import { describe, it, expect } from 'vitest';
import { UndoManager } from '../../src/core/UndoManager';

describe('UndoManager', () => {
	it('starts with no undo/redo available', () => {
		const mgr = new UndoManager<number>();
		expect(mgr.canUndo()).toBe(false);
		expect(mgr.canRedo()).toBe(false);
	});

	it('push makes undo available', () => {
		const mgr = new UndoManager<number>();
		mgr.push(1);
		expect(mgr.canUndo()).toBe(true);
	});

	it('undo returns previous snapshot and enables redo', () => {
		const mgr = new UndoManager<number>();
		mgr.push(10);

		const result = mgr.undo(20);

		expect(result).toBe(10);
		expect(mgr.canUndo()).toBe(false);
		expect(mgr.canRedo()).toBe(true);
	});

	it('redo returns next snapshot and enables undo', () => {
		const mgr = new UndoManager<number>();
		mgr.push(10);
		mgr.undo(20);

		const result = mgr.redo(20);

		expect(result).toBe(20);
		expect(mgr.canUndo()).toBe(true);
		expect(mgr.canRedo()).toBe(false);
	});

	it('undo on empty stack returns undefined', () => {
		const mgr = new UndoManager<number>();
		expect(mgr.undo(0)).toBeUndefined();
	});

	it('redo on empty stack returns undefined', () => {
		const mgr = new UndoManager<number>();
		expect(mgr.redo(0)).toBeUndefined();
	});

	it('push clears redo stack', () => {
		const mgr = new UndoManager<number>();
		mgr.push(1);
		mgr.push(2);
		mgr.undo(3);
		expect(mgr.canRedo()).toBe(true);

		mgr.push(4);
		expect(mgr.canRedo()).toBe(false);
	});

	it('enforces max stack size of 20', () => {
		const mgr = new UndoManager<number>();
		for (let i = 0; i < 25; i++) {
			mgr.push(i);
		}

		let count = 0;
		while (mgr.canUndo()) {
			mgr.undo(0);
			count++;
		}
		expect(count).toBe(20);
	});

	it('deep-clones snapshots by default', () => {
		const mgr = new UndoManager<{ value: number }>();
		const obj = { value: 1 };

		mgr.push(obj);
		obj.value = 999;

		const restored = mgr.undo({ value: 0 });
		expect(restored?.value).toBe(1);
	});

	it('accepts a custom clone function', () => {
		const mgr = new UndoManager<number[]>((arr) => [...arr]);
		const original = [1, 2, 3];

		mgr.push(original);
		original.push(4);

		const restored = mgr.undo([]);
		expect(restored).toEqual([1, 2, 3]);
	});

	it('supports multiple undo/redo cycles', () => {
		const mgr = new UndoManager<string>();
		mgr.push('a');
		mgr.push('b');
		mgr.push('c');

		expect(mgr.undo('d')).toBe('c');
		expect(mgr.undo('d')).toBe('b');
		expect(mgr.redo('d')).toBe('d');
	});
});
