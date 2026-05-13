// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setupDragHold } from '../../src/ui/setupDragHold';

describe('setupDragHold', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it('keeps drag armed when the pointer leaves after the hold completes', () => {
		vi.useFakeTimers();
		const grip = document.createElement('div');
		const draggable = document.createElement('div');

		setupDragHold({ grip, draggable, holdMs: 100 });

		grip.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
		vi.advanceTimersByTime(100);
		grip.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));

		expect(draggable.getAttribute('draggable')).toBe('true');
		expect(draggable.classList.contains('vw-drag-ready')).toBe(true);
	});

	it('cancels the pending hold when the pointer leaves before arming', () => {
		vi.useFakeTimers();
		const grip = document.createElement('div');
		const draggable = document.createElement('div');

		setupDragHold({ grip, draggable, holdMs: 100 });

		grip.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
		grip.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
		vi.advanceTimersByTime(100);

		expect(draggable.getAttribute('draggable')).toBeNull();
		expect(draggable.classList.contains('vw-drag-ready')).toBe(false);
	});

	it('does not arm drag when shouldStart rejects the target', () => {
		vi.useFakeTimers();
		const grip = document.createElement('div');
		const draggable = document.createElement('div');

		setupDragHold({ grip, draggable, holdMs: 100, shouldStart: () => false });

		grip.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
		vi.advanceTimersByTime(100);

		expect(draggable.getAttribute('draggable')).toBeNull();
		expect(draggable.classList.contains('vw-drag-ready')).toBe(false);
	});
});
