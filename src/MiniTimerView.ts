/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard Welcome
 * Description: Compact pop-out timer view -- Spotify-style mini player for the active task
 * Created: 2026-03-11
 * Last Modified: 2026-03-11
 */

import { ItemView, WorkspaceLeaf, setIcon } from 'obsidian';
import { VIEW_TYPE_MINI_TIMER } from './core/types';
import { TimerEngine } from './core/TimerEngine';
import { TaskManager } from './core/TaskManager';
import { EventBus } from './core/EventBus';
import { TimerEvents, TimerTickPayload, TimerStateChangePayload } from './core/events';
import { createTimerRing, TimerRingHandle } from './ui/TimerRing';

const HEADLESS_CLASS = 'vw-mini-headless';

/** Compact pop-out timer view showing ring, countdown, task name, and hover controls. */
export class MiniTimerView extends ItemView {
	private timerEngine: TimerEngine;
	private taskManager: TaskManager;
	private eventBus: EventBus;
	private saveCallback: () => void;

	private displayEl: HTMLElement | null = null;
	private ringHandle: TimerRingHandle | null = null;
	private titleEl: HTMLElement | null = null;
	private controlsEl: HTMLElement | null = null;
	private idleEl: HTMLElement | null = null;
	private activeEl: HTMLElement | null = null;
	private unsubscribers: (() => void)[] = [];
	private lastControlKey = '';
	private headlessObserver: MutationObserver | null = null;
	private boundQuitHandler: ((e: KeyboardEvent) => void) | null = null;

	/** Creates the mini timer view bound to the timer engine and event bus. */
	constructor(
		leaf: WorkspaceLeaf,
		timerEngine: TimerEngine,
		taskManager: TaskManager,
		eventBus: EventBus,
		saveCallback: () => void,
	) {
		super(leaf);
		this.timerEngine = timerEngine;
		this.taskManager = taskManager;
		this.eventBus = eventBus;
		this.saveCallback = saveCallback;
	}

	/** @override */
	getViewType(): string {
		return VIEW_TYPE_MINI_TIMER;
	}

	/** @override */
	getDisplayText(): string {
		return 'Mini Timer';
	}

	/** @override */
	getIcon(): string {
		return 'timer';
	}

	/** @override */
	async onOpen(): Promise<void> {
		this.buildUI();
	}

	/** Force-render for popout windows where onOpen may not fire. */
	forceRender(): void {
		if (this.contentEl.querySelector('.vw-mini-timer')) return;
		this.buildUI();
	}

	/** Constructs the full mini timer DOM tree and subscribes to timer events. */
	private buildUI(): void {
		const container = this.contentEl;
		container.empty();
		container.addClass('vw-mini-timer');

		this.renderIdle(container);
		this.renderActive(container);
		this.syncVisibility();

		for (const unsub of this.unsubscribers) unsub();
		this.unsubscribers = [];

		this.unsubscribers.push(
			this.eventBus.on<TimerTickPayload>(TimerEvents.Tick, () => this.updateDisplay()),
			this.eventBus.on<TimerStateChangePayload>(TimerEvents.StateChange, () => {
				this.syncVisibility();
				this.rebuildControls();
				this.updateDisplay();
			}),
		);

		this.watchHeadlessClass();
		this.bindPopoutShortcuts();
	}

	/** @override */
	async onClose(): Promise<void> {
		for (const unsub of this.unsubscribers) unsub();
		this.unsubscribers = [];
		this.headlessObserver?.disconnect();
		this.headlessObserver = null;
		if (this.boundQuitHandler) {
			this.containerEl.ownerDocument?.removeEventListener('keydown', this.boundQuitHandler);
			this.boundQuitHandler = null;
		}
		this.containerEl.ownerDocument?.body?.classList.remove(HEADLESS_CLASS);
	}

	/** Updates the timer display and ring on each tick. */
	updateDisplay(): void {
		if (this.displayEl) {
			this.displayEl.setText(this.timerEngine.formatRemaining());
			this.displayEl.toggleClass('vw-mini-timer-negative', this.timerEngine.isNegative());
		}
		this.ringHandle?.update(this.timerEngine.getProgress(), this.timerEngine.isNegative());
	}

	/** Monitors the popout body and re-applies the headless class if Obsidian removes it. */
	private watchHeadlessClass(): void {
		const doc = this.containerEl.ownerDocument;
		if (doc?.body?.classList.contains('is-popout-window') === false) return;

		doc.body.classList.add(HEADLESS_CLASS);

		this.headlessObserver?.disconnect();
		this.headlessObserver = new MutationObserver(() => {
			if (doc.body.classList.contains(HEADLESS_CLASS) === false) {
				doc.body.classList.add(HEADLESS_CLASS);
			}
		});
		this.headlessObserver.observe(doc.body, {
			attributes: true,
			attributeFilter: ['class'],
		});
	}

	/** Binds Cmd+Q in popout windows to close the main Obsidian window. */
	private bindPopoutShortcuts(): void {
		const doc = this.containerEl.ownerDocument;
		if (doc?.body?.classList.contains('is-popout-window') === false) return;

		this.boundQuitHandler = (e: KeyboardEvent) => {
			if (e.metaKey && e.key === 'q') {
				e.preventDefault();
				e.stopImmediatePropagation();
				this.quitApp();
			}
		};
		doc.addEventListener('keydown', this.boundQuitHandler, true);
	}

	/** Closes the main Obsidian window from a popout context. */
	private quitApp(): void {
		const mainWin = this.app.workspace.containerEl?.ownerDocument?.defaultView;
		if (mainWin) mainWin.close();
	}

	/** Renders the idle state placeholder shown when no task is running. */
	private renderIdle(parent: HTMLElement): void {
		this.idleEl = parent.createDiv({ cls: 'vw-mini-idle' });
		const iconEl = this.idleEl.createSpan({ cls: 'vw-mini-idle-icon' });
		setIcon(iconEl, 'clock');
		this.idleEl.createSpan({ cls: 'vw-mini-idle-text', text: 'No active task' });
	}

	/** Renders the active timer state with ring, countdown, controls, and task title marquee. */
	private renderActive(parent: HTMLElement): void {
		this.activeEl = parent.createDiv({ cls: 'vw-mini-active' });

		const ringWrap = this.activeEl.createDiv({ cls: 'vw-mini-ring-wrap' });
		this.ringHandle = createTimerRing(ringWrap, {
			size: 44,
			radius: 18,
			bgClass: 'vw-mini-ring-bg',
			ringClass: 'vw-mini-ring',
			negativeClass: 'vw-mini-timer-negative',
		});
		if (this.timerEngine.getState().isRunning) {
			this.ringHandle.update(this.timerEngine.getProgress(), this.timerEngine.isNegative());
		}

		const display = ringWrap.createDiv({ cls: 'vw-mini-display' });
		display.setText(this.timerEngine.formatRemaining());
		this.displayEl = display;

		this.controlsEl = this.activeEl.createDiv({ cls: 'vw-mini-controls' });
		this.rebuildControls();

		const marquee = this.activeEl.createDiv({ cls: 'vw-mini-marquee' });
		this.titleEl = marquee.createSpan({ cls: 'vw-mini-marquee-text' });
		this.updateTitle();
	}

	/** Updates the marquee text with the current task name or "Break". */
	private updateTitle(): void {
		if (this.titleEl === null) return;
		const state = this.timerEngine.getState();
		const task = state.currentTaskId ? this.taskManager.getTask(state.currentTaskId) : null;
		const text = this.timerEngine.isOnBreak() ? 'Break' : (task?.title ?? 'No Active Task');
		this.titleEl.setText(text);
	}

	/** Rebuilds pause/resume/complete/skip buttons based on current timer state. */
	private rebuildControls(): void {
		if (this.controlsEl === null) return;

		const state = this.timerEngine.getState();
		const key = `${state.isRunning}:${state.isPaused}:${this.timerEngine.isOnBreak()}`;
		if (key === this.lastControlKey) return;
		this.lastControlKey = key;

		this.controlsEl.empty();
		if (state.isRunning === false) return;

		if (state.isPaused) {
			this.addControlBtn(this.controlsEl, 'play', 'Resume', () => {
				this.timerEngine.resume();
			});
		} else {
			this.addControlBtn(this.controlsEl, 'pause', 'Pause', () => {
				this.timerEngine.pause();
			});
		}

		if (this.timerEngine.isOnBreak()) {
			this.addControlBtn(this.controlsEl, 'skip-forward', 'Skip break', () => {
				this.timerEngine.completePomodoroBreak();
			});
		} else {
			this.addControlBtn(this.controlsEl, 'check', 'Complete', () => {
				if (this.timerEngine.isPomodoroMode()) {
					this.timerEngine.completePomodoroWork();
				} else {
					this.timerEngine.stop();
				}
			});
			this.addControlBtn(this.controlsEl, 'skip-forward', 'Skip', () => {
				const taskId = this.timerEngine.getState().currentTaskId;
				if (taskId) {
					this.taskManager.skipTask(taskId);
					this.timerEngine.cancel();
					this.saveCallback();
				}
			});
		}
	}

	/** Creates an accessible icon button in the controls bar. */
	private addControlBtn(parent: HTMLElement, icon: string, label: string, onClick: () => void): void {
		const btn = parent.createDiv({ cls: 'vw-mini-ctrl' });
		setIcon(btn, icon);
		btn.setAttribute('aria-label', label);
		btn.setAttribute('tabindex', '0');
		btn.addEventListener('click', (e) => {
			e.stopPropagation();
			onClick();
		});
		btn.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				onClick();
			}
		});
	}

	/** Toggles between idle and active views based on whether the timer is running. */
	private syncVisibility(): void {
		const running = this.timerEngine.getState().isRunning;
		this.idleEl?.toggleClass('vw-mini-hidden', running);
		this.activeEl?.toggleClass('vw-mini-hidden', running === false);
		this.updateTitle();
	}
}
