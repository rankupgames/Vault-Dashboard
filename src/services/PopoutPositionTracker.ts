/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard
 * Description: Tracks and persists the screen position of an Electron popout window
 * Created: 2026-03-14
 * Last Modified: 2026-03-14
 */

/** Persistent screen coordinates. */
export interface ScreenPosition {
	x: number;
	y: number;
}

/** Display bounds rectangle. */
export interface DisplayBounds {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** Minimal Electron BrowserWindow surface needed for position tracking. */
export interface PopoutWindowHandle {
	isDestroyed(): boolean;
	getPosition(): number[];
	setPosition(x: number, y: number): void;
	on(event: string, cb: () => void): void;
}

/** Configuration for constructing a PopoutPositionTracker. */
export interface PopoutPositionTrackerOpts {
	/** Previously persisted position (null = first open, use OS default). */
	initial: ScreenPosition | null;
	/** Fires whenever the tracked position changes so the host can persist. */
	onChange: (position: ScreenPosition) => void;
	/** Returns bounds of all connected displays for on-screen validation. */
	getDisplays: () => DisplayBounds[];
}

/**
 * Tracks and persists the screen position of a popout window.
 * Composable -- the host provides persistence and display queries via callbacks.
 */
export class PopoutPositionTracker {
	private window: PopoutWindowHandle | null = null;
	private position: ScreenPosition | null;
	private onChange: (position: ScreenPosition) => void;
	private getDisplays: () => DisplayBounds[];

	constructor(opts: PopoutPositionTrackerOpts) {
		this.position = opts.initial;
		this.onChange = opts.onChange;
		this.getDisplays = opts.getDisplays;
	}

	/** Returns the last known position, or null if never set. */
	getPosition(): ScreenPosition | null {
		return this.position;
	}

	/** Begins tracking a window. Captures the previous window's position first. */
	track(win: PopoutWindowHandle): void {
		this.capture();
		this.window = win;
		win.on('moved', () => this.capture());
	}

	/** Moves the window to the saved position if it falls within a visible display. */
	restore(win: PopoutWindowHandle): void {
		if (this.position === null) return;

		const { x, y } = this.position;
		const visible = this.getDisplays().some((b) =>
			x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height,
		);

		if (visible) {
			win.setPosition(x, y);
		}
	}

	/** Reads and stores the current window position if the window is still alive. */
	capture(): void {
		if (this.window === null || this.window.isDestroyed()) return;
		const [x, y] = this.window.getPosition();
		this.position = { x, y };
		this.onChange(this.position);
	}

	/** Captures the final position and drops the window reference. */
	release(): void {
		this.capture();
		this.window = null;
	}
}
