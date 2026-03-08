/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard Welcome
 * Description: Clock-aligned countdown timer with snap boundaries, rollover logic, and pause/resume
 * Created: 2026-03-07
 * Last Modified: 2026-03-07
 */

import { TimerState, TimerEventCallback, TimerCompleteCallback, PluginSettings } from './types';

export type PomodoroBreakCallback = (isLongBreak: boolean) => void;

export class TimerEngine {
	private intervalId: number | null = null;
	private state: TimerState;
	private onTick: TimerEventCallback | null = null;
	private onComplete: TimerCompleteCallback | null = null;
	private onStateChange: (() => void) | null = null;
	private onBreakComplete: PomodoroBreakCallback | null = null;
	private snapIntervalMs: number;
	private settings: PluginSettings;

	constructor(state: TimerState, settings: PluginSettings) {
		this.state = state;
		this.settings = settings;
		this.snapIntervalMs = settings.snapIntervalMinutes * 60 * 1000;
	}

	getState(): TimerState {
		return { ...this.state };
	}

	getRolloverBalance(): number {
		return this.state.rolloverBalance;
	}

	resetRollover(): void {
		this.state.rolloverBalance = 0;
		this.emitStateChange();
	}

	addRollover(minutes: number): void {
		this.state.rolloverBalance += minutes;
		this.emitStateChange();
	}

	setSnapInterval(minutes: number): void {
		this.snapIntervalMs = minutes * 60 * 1000;
	}

	onTickCallback(cb: TimerEventCallback): void {
		this.onTick = cb;
	}

	onCompleteCallback(cb: TimerCompleteCallback): void {
		this.onComplete = cb;
	}

	onBreakCompleteCallback(cb: PomodoroBreakCallback): void {
		this.onBreakComplete = cb;
	}

	onStateChangeCallback(cb: () => void): void {
		this.onStateChange = cb;
	}

	isPomodoroMode(): boolean {
		return this.settings.timerMode === 'pomodoro';
	}

	isOnBreak(): boolean {
		return this.state.isBreak;
	}

	getPomodoroCount(): number {
		return this.state.pomodoroCount;
	}

	resetPomodoroCount(): void {
		this.state.pomodoroCount = 0;
		this.emitStateChange();
	}

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

	completePomodoroWork(): void {
		if (this.state.isRunning === false) return;
		this.state.pomodoroCount++;
		const taskId = this.state.currentTaskId;

		this.stopInterval();
		this.startPomodoroBreak();

		if (taskId && this.onComplete) {
			this.onComplete(taskId, 0);
		}
	}

	completePomodoroBreak(): void {
		if (this.state.isRunning === false || this.state.isBreak === false) return;
		const isLong = this.state.pomodoroCount > 0
			&& this.state.pomodoroCount % this.settings.pomodoroLongBreakInterval === 0;

		this.stopInterval();
		this.state.isRunning = false;
		this.state.isBreak = false;
		this.emitStateChange();

		if (this.onBreakComplete) {
			this.onBreakComplete(isLong);
		}
	}

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

	resume(): void {
		if (this.state.isRunning === false || this.state.isPaused === false) return;
		if (this.state.pausedRemaining === null) return;

		this.state.endTime = Date.now() + this.state.pausedRemaining;
		this.state.isPaused = false;
		this.state.pausedRemaining = null;

		this.emitStateChange();
		this.beginInterval();
	}

	pause(): void {
		if (this.state.isRunning === false || this.state.isPaused) return;
		if (this.state.endTime === null) return;

		this.state.pausedRemaining = this.state.endTime - Date.now();
		this.state.isPaused = true;

		this.stopInterval();
		this.emitStateChange();
	}

	getTaskRollover(): number {
		if (this.state.isRunning === false) return 0;
		const rawMin = this.getRemaining() / 60000;
		const cap = this.state.baseDurationMinutes;
		if (cap <= 0) return rawMin;
		return Math.max(-cap, Math.min(cap, rawMin));
	}

	stop(): void {
		if (this.state.isRunning === false) return;

		const rollover = this.getTaskRollover();
		const taskId = this.state.currentTaskId;

		this.state.rolloverBalance = rollover;
		this.reset();
		this.emitStateChange();

		if (taskId && this.onComplete) {
			this.onComplete(taskId, rollover);
		}
	}

	cancel(): void {
		this.reset();
		this.emitStateChange();
	}

	skip(): void {
		const taskId = this.state.currentTaskId;
		this.reset();
		this.emitStateChange();

		if (taskId && this.onComplete) {
			this.onComplete(taskId, 0);
		}
	}

	getRemaining(): number {
		if (this.state.isPaused && this.state.pausedRemaining !== null) {
			return this.state.pausedRemaining;
		}
		if (this.state.endTime === null) return 0;
		return this.state.endTime - Date.now();
	}

	isNegative(): boolean {
		return this.getRemaining() < 0;
	}

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

	getEndTimeFormatted(): string {
		if (this.state.endTime === null) return '--:--';
		const d = new Date(this.state.endTime);
		const h = d.getHours();
		const m = d.getMinutes();
		const ampm = h >= 12 ? 'pm' : 'am';
		const h12 = h % 12 || 12;
		return `${h12}:${String(m).padStart(2, '0')}${ampm}`;
	}

	restoreFromState(state: TimerState): void {
		this.state = { ...state };
		if (this.state.isRunning && this.state.isPaused === false) {
			this.beginInterval();
		}
	}

	destroy(): void {
		this.stopInterval();
	}

	private beginInterval(): void {
		this.stopInterval();
		this.intervalId = window.setInterval(() => {
			const remaining = this.getRemaining();
			const isNeg = remaining < 0;

			if (this.onTick) {
				this.onTick(remaining, isNeg);
			}

			this.emitStateChange();
		}, 250);
	}

	private stopInterval(): void {
		if (this.intervalId !== null) {
			window.clearInterval(this.intervalId);
			this.intervalId = null;
		}
	}

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

	private emitStateChange(): void {
		if (this.onStateChange) {
			this.onStateChange();
		}
	}
}
