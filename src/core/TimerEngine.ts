/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard
 * Description: Clock-aligned countdown timer with snap boundaries, rollover logic, and pause/resume
 * Created: 2026-03-07
 * Last Modified: 2026-03-07
 */

import { TimerState, TimerEventCallback, TimerCompleteCallback, PluginSettings } from './types';
import { EventBus } from './EventBus';
import {
	TimerEvents,
	TimerTickPayload,
	TimerCompletePayload,
	TimerBreakCompletePayload,
	TimerStateChangePayload,
} from './events';

/** Callback invoked when a pomodoro break completes. */
export type PomodoroBreakCallback = (isLongBreak: boolean) => void;

/** Clock-aligned countdown timer with snap boundaries, rollover logic, and pause/resume. */
export class TimerEngine {
	private intervalId: number | null = null;
	private state: TimerState;
	private onTick: TimerEventCallback | null = null;
	private onComplete: TimerCompleteCallback | null = null;
	private onStateChange: (() => void) | null = null;
	private onBreakComplete: PomodoroBreakCallback | null = null;
	private snapIntervalMs: number;
	private settings: PluginSettings;
	private bus: EventBus;

	/** Initializes the timer engine with saved state, settings, and optional event bus. */
	constructor(state: TimerState, settings: PluginSettings, bus?: EventBus) {
		this.state = state;
		this.settings = settings;
		this.snapIntervalMs = settings.snapIntervalMinutes * 60 * 1000;
		this.bus = bus ?? new EventBus();
	}

	/** Returns the EventBus used for timer events. */
	getBus(): EventBus {
		return this.bus;
	}

	/** Returns a shallow copy of the current timer state. */
	getState(): TimerState {
		return { ...this.state };
	}

	/** Returns the current rollover balance in minutes. */
	getRolloverBalance(): number {
		return this.state.rolloverBalance;
	}

	/** Resets rollover balance to zero. */
	resetRollover(): void {
		this.state.rolloverBalance = 0;
		this.emitStateChange();
	}

	/** Adds minutes to the rollover balance. */
	addRollover(minutes: number): void {
		this.state.rolloverBalance += minutes;
		this.emitStateChange();
	}

	/** Sets the snap interval for clock-aligned boundaries (minutes). */
	setSnapInterval(minutes: number): void {
		this.snapIntervalMs = minutes * 60 * 1000;
	}

	/** Registers a callback for each tick. */
	onTickCallback(cb: TimerEventCallback): void {
		this.onTick = cb;
	}

	/** Registers a callback for timer completion. */
	onCompleteCallback(cb: TimerCompleteCallback): void {
		this.onComplete = cb;
	}

	/** Registers a callback for pomodoro break completion. */
	onBreakCompleteCallback(cb: PomodoroBreakCallback): void {
		this.onBreakComplete = cb;
	}

	/** Registers a callback for state changes. */
	onStateChangeCallback(cb: () => void): void {
		this.onStateChange = cb;
	}

	/** Returns true if timer mode is pomodoro. */
	isPomodoroMode(): boolean {
		return this.settings.timerMode === 'pomodoro';
	}

	/** Returns true if currently on a pomodoro break. */
	isOnBreak(): boolean {
		return this.state.isBreak;
	}

	/** Returns the number of completed pomodoro work sessions. */
	getPomodoroCount(): number {
		return this.state.pomodoroCount;
	}

	/** Resets pomodoro count to zero. */
	resetPomodoroCount(): void {
		this.state.pomodoroCount = 0;
		this.emitStateChange();
	}

	/** Starts a pomodoro work session. */
	startPomodoro(taskId: string, workMinutes?: number): void {
		if (this.state.isRunning) return;
		const duration = workMinutes ?? this.settings.pomodoroWorkMinutes;
		this.state.baseDurationMinutes = duration;
		this.state.currentTaskId = taskId;
		this.state.startTime = Date.now();
		this.state.endTime = Date.now() + duration * 60_000;
		this.state.isRunning = true;
		this.state.isPaused = false;
		this.state.pausedRemaining = null;
		this.state.isBreak = false;
		this.emitStateChange();
		this.beginInterval();
	}

	/** Starts a pomodoro break (short or long based on count). */
	startPomodoroBreak(): void {
		const isLong = this.state.pomodoroCount > 0
			&& this.state.pomodoroCount % this.settings.pomodoroLongBreakInterval === 0;
		const breakMin = isLong ? this.settings.pomodoroLongBreakMinutes : this.settings.pomodoroBreakMinutes;

		this.state.startTime = Date.now();
		this.state.endTime = Date.now() + breakMin * 60_000;
		this.state.baseDurationMinutes = breakMin;
		this.state.isRunning = true;
		this.state.isPaused = false;
		this.state.pausedRemaining = null;
		this.state.isBreak = true;
		this.emitStateChange();
		this.beginInterval();
	}

	/** Completes the current work session and starts a break. */
	completePomodoroWork(): void {
		if (this.state.isRunning === false) return;
		this.state.pomodoroCount++;
		const taskId = this.state.currentTaskId;

		this.stopInterval();
		this.startPomodoroBreak();

		if (taskId) {
			if (this.onComplete) this.onComplete(taskId, 0);
			this.bus.emit<TimerCompletePayload>(TimerEvents.Complete, { taskId, rollover: 0 });
		}
	}

	/** Completes the current break and stops the timer. */
	completePomodoroBreak(): void {
		if (this.state.isRunning === false || this.state.isBreak === false) return;
		const isLong = this.state.pomodoroCount > 0
			&& this.state.pomodoroCount % this.settings.pomodoroLongBreakInterval === 0;

		this.stopInterval();
		this.state.isRunning = false;
		this.state.isBreak = false;
		this.emitStateChange();

		if (this.onBreakComplete) this.onBreakComplete(isLong);
		this.bus.emit<TimerBreakCompletePayload>(TimerEvents.BreakComplete, { isLongBreak: isLong });
	}

	/**
	 * Computes an end time snapped to the configured interval boundaries.
	 * @param durationMinutes - Planned duration
	 * @param rollover - Rollover minutes to add
	 * @returns End timestamp (ms)
	 */
	computeAlignedEnd(durationMinutes: number, rollover: number): number {
		const now = Date.now();
		const todayStart = new Date();
		todayStart.setHours(0, 0, 0, 0);

		const msSinceMidnight = now - todayStart.getTime();
		const msPastBoundary = msSinceMidnight % this.snapIntervalMs;
		const minutesPastBoundary = msPastBoundary / 60_000;

		const GRACE_MINUTES = 5;

		if (minutesPastBoundary <= GRACE_MINUTES) {
			const lastBoundary = now - msPastBoundary;
			const effectiveDurationMs = (durationMinutes + rollover) * 60_000;
			const rawEnd = lastBoundary + Math.max(effectiveDurationMs, 60_000);
			const msFromMidnight = rawEnd - todayStart.getTime();
			const snappedMs = Math.ceil(msFromMidnight / this.snapIntervalMs) * this.snapIntervalMs;
			return todayStart.getTime() + snappedMs;
		}

		const effectiveDurationMs = (durationMinutes + rollover) * 60_000;
		const rawEnd = now + Math.max(effectiveDurationMs, 60_000);
		const msFromMidnight = rawEnd - todayStart.getTime();
		const snappedMs = Math.ceil(msFromMidnight / this.snapIntervalMs) * this.snapIntervalMs;

		return todayStart.getTime() + snappedMs;
	}

	/** Starts a clock-aligned timer for the given task. */
	start(taskId: string, durationMinutes: number): void {
		if (this.state.isRunning) return;

		this.state.baseDurationMinutes = durationMinutes;
		const endTime = this.computeAlignedEnd(durationMinutes, this.state.rolloverBalance);
		this.state.rolloverBalance = 0;

		this.state.currentTaskId = taskId;
		this.state.startTime = Date.now();
		this.state.endTime = endTime;
		this.state.isRunning = true;
		this.state.isPaused = false;
		this.state.pausedRemaining = null;

		this.emitStateChange();
		this.beginInterval();
	}

	/** Resumes a paused timer, shifting startTime forward so the pause gap is excluded from progress. */
	resume(): void {
		if (this.state.isRunning === false || this.state.isPaused === false) return;
		if (this.state.pausedRemaining === null || this.state.endTime === null) return;

		const pauseStart = this.state.endTime - this.state.pausedRemaining;
		const pauseDuration = Date.now() - pauseStart;

		if (this.state.startTime !== null) {
			this.state.startTime += pauseDuration;
		}

		this.state.endTime = Date.now() + this.state.pausedRemaining;
		this.state.isPaused = false;
		this.state.pausedRemaining = null;

		this.emitStateChange();
		this.beginInterval();
	}

	/** Pauses the running timer. */
	pause(): void {
		if (this.state.isRunning === false || this.state.isPaused) return;
		if (this.state.endTime === null) return;

		this.state.pausedRemaining = this.state.endTime - Date.now();
		this.state.isPaused = true;

		this.stopInterval();
		this.emitStateChange();
	}

	/** Returns rollover minutes for the current task (capped by base duration). */
	getTaskRollover(): number {
		if (this.state.isRunning === false) return 0;
		const rawMin = this.getRemaining() / 60000;
		const cap = this.state.baseDurationMinutes;
		if (cap <= 0) return rawMin;
		return Math.max(-cap, Math.min(cap, rawMin));
	}

	/** Stops the timer, applies rollover, and invokes completion callback. */
	stop(): void {
		if (this.state.isRunning === false) return;

		const rollover = this.getTaskRollover();
		const taskId = this.state.currentTaskId;

		this.state.rolloverBalance = rollover;
		this.reset();
		this.emitStateChange();

		if (taskId) {
			if (this.onComplete) this.onComplete(taskId, rollover);
			this.bus.emit<TimerCompletePayload>(TimerEvents.Complete, { taskId, rollover });
		}
	}

	/** Cancels the timer without invoking completion callback. */
	cancel(): void {
		this.reset();
		this.emitStateChange();
	}

	/** Skips the current task with zero rollover. */
	skip(): void {
		const taskId = this.state.currentTaskId;
		this.reset();
		this.emitStateChange();

		if (taskId) {
			if (this.onComplete) this.onComplete(taskId, 0);
			this.bus.emit<TimerCompletePayload>(TimerEvents.Complete, { taskId, rollover: 0 });
		}
	}

	/** Returns remaining milliseconds (negative if overrun). */
	getRemaining(): number {
		if (this.state.isPaused && this.state.pausedRemaining !== null) {
			return this.state.pausedRemaining;
		}
		if (this.state.endTime === null) return 0;
		return this.state.endTime - Date.now();
	}

	/** Returns true if the timer has gone past zero. */
	isNegative(): boolean {
		return this.getRemaining() < 0;
	}

	/** Returns remaining time as HH:MM:SS string (with leading minus if negative). */
	formatRemaining(): string {
		const ms = this.getRemaining();
		const negative = ms < 0;
		const abs = Math.abs(ms);
		const totalSeconds = Math.floor(abs / 1000);
		const hours = Math.floor(totalSeconds / 3600);
		const minutes = Math.floor((totalSeconds % 3600) / 60);
		const seconds = totalSeconds % 60;

		const prefix = negative ? '-' : '';
		return `${prefix}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
	}

	/** Returns progress from 0 to 1. */
	getProgress(): number {
		if (this.state.startTime === null || this.state.endTime === null) return 0;
		const total = this.state.endTime - this.state.startTime;
		if (total <= 0) return 1;

		if (this.state.isPaused && this.state.pausedRemaining !== null) {
			const elapsed = total - this.state.pausedRemaining;
			return Math.min(Math.max(elapsed / total, 0), 1);
		}

		const elapsed = Date.now() - this.state.startTime;
		return Math.min(Math.max(elapsed / total, 0), 1);
	}

	/** Returns the end time as a formatted string (e.g. "2:30pm"). */
	getEndTimeFormatted(): string {
		if (this.state.endTime === null) return '--:--';
		const d = new Date(this.state.endTime);
		const h = d.getHours();
		const m = d.getMinutes();
		const ampm = h >= 12 ? 'pm' : 'am';
		const h12 = h % 12 || 12;
		return `${h12}:${String(m).padStart(2, '0')}${ampm}`;
	}

	/** Restores timer from a saved state and resumes interval if running. */
	restoreFromState(state: TimerState): void {
		this.state = { ...state };
		if (this.state.isRunning && this.state.isPaused === false) {
			this.beginInterval();
		}
	}

	/** Stops the interval and cleans up. */
	destroy(): void {
		this.stopInterval();
	}

	/** Starts the 250ms tick interval that drives display updates and state changes. */
	private beginInterval(): void {
		this.stopInterval();
		this.intervalId = window.setInterval(() => {
			const remaining = this.getRemaining();
			const isNeg = remaining < 0;

			if (this.onTick) {
				this.onTick(remaining, isNeg);
			}
			this.bus.emit<TimerTickPayload>(TimerEvents.Tick, { remaining, isNegative: isNeg });

			this.emitStateChange();
		}, 250);
	}

	/** Clears the active tick interval. */
	private stopInterval(): void {
		if (this.intervalId !== null) {
			window.clearInterval(this.intervalId);
			this.intervalId = null;
		}
	}

	/** Resets all running state without triggering callbacks. */
	private reset(): void {
		this.stopInterval();
		this.state.currentTaskId = null;
		this.state.startTime = null;
		this.state.endTime = null;
		this.state.baseDurationMinutes = 0;
		this.state.isRunning = false;
		this.state.isPaused = false;
		this.state.pausedRemaining = null;
	}

	/** Invokes the state-change callback and emits the StateChange event on the bus. */
	private emitStateChange(): void {
		if (this.onStateChange) {
			this.onStateChange();
		}
		this.bus.emit<TimerStateChangePayload>(TimerEvents.StateChange, { state: this.getState() });
	}
}
