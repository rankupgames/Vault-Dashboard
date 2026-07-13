/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vaultboard
 * Description: Composable drag-hold utility -- requires a timed hold before enabling native drag
 * Created: 2026-03-17
 * Last Modified: 2026-05-13
 */

const DRAG_HOLD_MS = 1000;

/** Configuration for a drag-hold interaction. */
export interface DragHoldOpts {
	/** Element the user presses and holds on (handle, header, or the row itself). */
	grip: HTMLElement;
	/** Element that receives the draggable attribute and visual classes. */
	draggable: HTMLElement;
	/** Hold duration in ms before drag activates. Defaults to 1000. */
	holdMs?: number;
	/** Return false from a mousedown to skip the hold (e.g. clicked an action button). */
	shouldStart?: (e: MouseEvent) => boolean;
	/** Called once the native dragstart fires (after hold completed). */
	onDragStart?: (e: DragEvent) => void;
	/** Called when the drag ends. */
	onDragEnd?: () => void;
}

/**
 * Wires a hold-to-drag interaction on a grip/draggable pair.
 * The user must hold for `holdMs` before the element becomes draggable.
 * A pulsing `vw-drag-ready` class signals the drag is armed.
 * Returns a teardown function that removes all listeners.
 */
export const setupDragHold = (opts: DragHoldOpts): (() => void) => {
	const { grip, draggable, holdMs = DRAG_HOLD_MS, shouldStart, onDragStart, onDragEnd } = opts;
	let holdTimer: ReturnType<typeof setTimeout> | null = null;
	let dragArmed = false;

	const cancelHold = (): void => {
		if (holdTimer !== null) { clearTimeout(holdTimer); holdTimer = null; }
		dragArmed = false;
		draggable.removeAttribute('draggable');
		draggable.classList.remove('vw-drag-ready');
	};

	const onMouseDown = (e: MouseEvent): void => {
		if (e.button !== 0) return;
		if (shouldStart?.(e) === false) return;
		cancelHold();
		holdTimer = setTimeout(() => {
			holdTimer = null;
			dragArmed = true;
			draggable.classList.add('vw-drag-ready');
			draggable.setAttribute('draggable', 'true');
		}, holdMs);
	};

	const onDragStartEvt = (e: DragEvent): void => {
		if (e.target !== draggable) return;
		if (dragArmed === false || draggable.getAttribute('draggable') !== 'true') { e.preventDefault(); return; }
		dragArmed = false;
		draggable.classList.remove('vw-drag-ready');
		onDragStart?.(e);
	};

	const onDragEndEvt = (): void => {
		cancelHold();
		onDragEnd?.();
	};

	const onMouseLeave = (): void => {
		if (holdTimer !== null) cancelHold();
	};

	grip.addEventListener('mousedown', onMouseDown);
	grip.addEventListener('mouseup', cancelHold);
	grip.addEventListener('mouseleave', onMouseLeave);
	draggable.addEventListener('dragstart', onDragStartEvt);
	draggable.addEventListener('dragend', onDragEndEvt);

	return () => {
		cancelHold();
		grip.removeEventListener('mousedown', onMouseDown);
		grip.removeEventListener('mouseup', cancelHold);
		grip.removeEventListener('mouseleave', onMouseLeave);
		draggable.removeEventListener('dragstart', onDragStartEvt);
		draggable.removeEventListener('dragend', onDragEndEvt);
	};
};
