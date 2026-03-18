import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { TimerEngine } from '../../src/core/TimerEngine';
import { TimerState, DEFAULT_SETTINGS, PluginSettings } from '../../src/core/types';
import { EventBus } from '../../src/core/EventBus';

const makeState = (overrides?: Partial<TimerState>): TimerState => ({
	isRunning: false,
	isPaused: false,
	currentTaskId: null,
	startTime: null,
	endTime: null,
	pausedRemaining: null,
	baseDurationMinutes: 0,
	rolloverBalance: 0,
	isBreak: false,
	pomodoroCount: 0,
	ghostTaskName: null,
	needsRealign: false,
	suspendedTaskId: null,
	suspendedBaseDuration: 0,
	...overrides,
});

const makeSettings = (overrides?: Partial<PluginSettings>): PluginSettings => ({
	...JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
	...overrides,
});

const stubTimers = (): void => {
	vi.stubGlobal('window', {
		setInterval: vi.fn(() => 1),
		clearInterval: vi.fn(),
	});
};

describe('TimerEngine', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		stubTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	describe('initial state', () => {
		it('returns a copy of state, not the original', () => {
			const state = makeState();
			const engine = new TimerEngine(state, makeSettings());
			const copy = engine.getState();

			copy.isRunning = true;
			expect(engine.getState().isRunning).toBe(false);
		});

		it('starts with zero rollover', () => {
			const engine = new TimerEngine(makeState(), makeSettings());
			expect(engine.getRolloverBalance()).toBe(0);
		});
	});

	describe('rollover management', () => {
		it('addRollover accumulates balance', () => {
			const engine = new TimerEngine(makeState(), makeSettings());
			engine.addRollover(5);
			engine.addRollover(3);
			expect(engine.getRolloverBalance()).toBe(8);
		});

		it('resetRollover zeros the balance', () => {
			const engine = new TimerEngine(makeState({ rolloverBalance: 10 }), makeSettings());
			engine.resetRollover();
			expect(engine.getRolloverBalance()).toBe(0);
		});
	});

	describe('computeAlignedEnd', () => {
		it('snaps to the next boundary', () => {
			vi.setSystemTime(new Date('2026-03-09T14:12:00'));

			const engine = new TimerEngine(makeState(), makeSettings({ snapIntervalMinutes: 30 }));
			const end = engine.computeAlignedEnd(30, 0);

			const endDate = new Date(end);
			expect(endDate.getMinutes() % 30).toBe(0);
			expect(end).toBeGreaterThan(Date.now());
		});

		it('accounts for rollover in effective duration', () => {
			vi.setSystemTime(new Date('2026-03-09T14:12:00'));

			const engine = new TimerEngine(makeState(), makeSettings({ snapIntervalMinutes: 30 }));
			const withoutRollover = engine.computeAlignedEnd(30, 0);
			const withRollover = engine.computeAlignedEnd(30, 15);

			expect(withRollover).toBeGreaterThanOrEqual(withoutRollover);
		});

		it('enforces minimum 1 minute duration', () => {
			vi.setSystemTime(new Date('2026-03-09T14:12:00'));

			const engine = new TimerEngine(makeState(), makeSettings({ snapIntervalMinutes: 30 }));
			const end = engine.computeAlignedEnd(0, 0);

			expect(end).toBeGreaterThan(Date.now());
		});

		it('uses grace period within 5 minutes of boundary', () => {
			vi.setSystemTime(new Date('2026-03-09T14:02:00'));

			const engine = new TimerEngine(makeState(), makeSettings({ snapIntervalMinutes: 30 }));
			const end = engine.computeAlignedEnd(30, 0);

			const endDate = new Date(end);
			expect(endDate.getMinutes() % 30).toBe(0);
		});
	});

	describe('start / stop lifecycle', () => {
		it('start transitions to running state', () => {
			const engine = new TimerEngine(makeState(), makeSettings());
			engine.start('task-1', 30);

			const state = engine.getState();
			expect(state.isRunning).toBe(true);
			expect(state.isPaused).toBe(false);
			expect(state.currentTaskId).toBe('task-1');
		});

		it('start is a no-op if already running', () => {
			const engine = new TimerEngine(makeState(), makeSettings());
			engine.start('task-1', 30);
			engine.start('task-2', 15);

			expect(engine.getState().currentTaskId).toBe('task-1');
		});

		it('start consumes rollover balance', () => {
			const engine = new TimerEngine(makeState({ rolloverBalance: 10 }), makeSettings());
			engine.start('task-1', 30);

			expect(engine.getRolloverBalance()).toBe(0);
		});

		it('stop resets state and fires completion callback', () => {
			const completeSpy = vi.fn();
			const engine = new TimerEngine(makeState(), makeSettings());
			engine.onCompleteCallback(completeSpy);

			engine.start('task-1', 30);
			engine.stop();

			expect(engine.getState().isRunning).toBe(false);
			expect(engine.getState().currentTaskId).toBeNull();
			expect(completeSpy).toHaveBeenCalledWith('task-1', expect.any(Number));
		});

		it('stop stores rollover balance', () => {
			vi.setSystemTime(new Date('2026-03-09T14:00:00'));

			const engine = new TimerEngine(makeState(), makeSettings({ snapIntervalMinutes: 30 }));
			engine.start('task-1', 30);

			const state = engine.getState();
			expect(state.endTime).not.toBeNull();

			engine.stop();
			expect(engine.getRolloverBalance()).not.toBe(0);
		});

		it('cancel resets without firing completion', () => {
			const completeSpy = vi.fn();
			const engine = new TimerEngine(makeState(), makeSettings());
			engine.onCompleteCallback(completeSpy);

			engine.start('task-1', 30);
			engine.cancel();

			expect(engine.getState().isRunning).toBe(false);
			expect(completeSpy).not.toHaveBeenCalled();
		});

		it('skip fires completion with zero rollover', () => {
			const completeSpy = vi.fn();
			const engine = new TimerEngine(makeState(), makeSettings());
			engine.onCompleteCallback(completeSpy);

			engine.start('task-1', 30);
			engine.skip();

			expect(completeSpy).toHaveBeenCalledWith('task-1', 0);
		});
	});

	describe('pause / resume', () => {
		it('pause freezes remaining time', () => {
			vi.setSystemTime(new Date('2026-03-09T14:00:00'));

			const engine = new TimerEngine(makeState(), makeSettings({ snapIntervalMinutes: 30 }));
			engine.start('task-1', 30);

			vi.setSystemTime(new Date('2026-03-09T14:10:00'));
			engine.pause();

			const state = engine.getState();
			expect(state.isPaused).toBe(true);
			expect(state.pausedRemaining).not.toBeNull();
		});

		it('pause is a no-op when not running', () => {
			const engine = new TimerEngine(makeState(), makeSettings());
			engine.pause();
			expect(engine.getState().isPaused).toBe(false);
		});

		it('resume clears pause state', () => {
			vi.setSystemTime(new Date('2026-03-09T14:00:00'));

			const engine = new TimerEngine(makeState(), makeSettings({ snapIntervalMinutes: 30 }));
			engine.start('task-1', 30);

			vi.setSystemTime(new Date('2026-03-09T14:10:00'));
			engine.pause();

			vi.setSystemTime(new Date('2026-03-09T14:15:00'));
			engine.resume();

			const state = engine.getState();
			expect(state.isPaused).toBe(false);
			expect(state.pausedRemaining).toBeNull();
			expect(state.isRunning).toBe(true);
		});

		it('resume shifts endTime to account for pause duration', () => {
			vi.setSystemTime(new Date('2026-03-09T14:00:00'));

			const engine = new TimerEngine(makeState(), makeSettings({ snapIntervalMinutes: 30 }));
			engine.start('task-1', 30);
			const originalEnd = engine.getState().endTime!;

			vi.setSystemTime(new Date('2026-03-09T14:10:00'));
			engine.pause();

			vi.setSystemTime(new Date('2026-03-09T14:20:00'));
			engine.resume();

			const newEnd = engine.getState().endTime!;
			expect(newEnd).toBeGreaterThan(originalEnd);
		});
	});

	describe('formatting', () => {
		it('formatRemaining returns HH:MM:SS when running', () => {
			vi.setSystemTime(new Date('2026-03-09T14:00:00'));

			const state = makeState({
				isRunning: true,
				endTime: new Date('2026-03-09T14:30:00').getTime(),
			});
			const engine = new TimerEngine(state, makeSettings());

			expect(engine.formatRemaining()).toBe('00:30:00');
		});

		it('formatRemaining shows negative prefix when overrun', () => {
			vi.setSystemTime(new Date('2026-03-09T14:35:00'));

			const state = makeState({
				isRunning: true,
				endTime: new Date('2026-03-09T14:30:00').getTime(),
			});
			const engine = new TimerEngine(state, makeSettings());

			expect(engine.formatRemaining()).toMatch(/^-/);
			expect(engine.isNegative()).toBe(true);
		});

		it('getEndTimeFormatted returns readable time', () => {
			const state = makeState({
				endTime: new Date('2026-03-09T14:30:00').getTime(),
			});
			const engine = new TimerEngine(state, makeSettings());

			expect(engine.getEndTimeFormatted()).toBe('2:30pm');
		});

		it('getEndTimeFormatted returns placeholder when no end', () => {
			const engine = new TimerEngine(makeState(), makeSettings());
			expect(engine.getEndTimeFormatted()).toBe('--:--');
		});
	});

	describe('progress', () => {
		it('returns 0 before start', () => {
			const engine = new TimerEngine(makeState(), makeSettings());
			expect(engine.getProgress()).toBe(0);
		});

		it('returns value between 0 and 1 mid-run', () => {
			vi.setSystemTime(new Date('2026-03-09T14:15:00'));

			const state = makeState({
				isRunning: true,
				startTime: new Date('2026-03-09T14:00:00').getTime(),
				endTime: new Date('2026-03-09T14:30:00').getTime(),
			});
			const engine = new TimerEngine(state, makeSettings());

			expect(engine.getProgress()).toBeCloseTo(0.5, 1);
		});

		it('caps at 1 when overrun', () => {
			vi.setSystemTime(new Date('2026-03-09T15:00:00'));

			const state = makeState({
				isRunning: true,
				startTime: new Date('2026-03-09T14:00:00').getTime(),
				endTime: new Date('2026-03-09T14:30:00').getTime(),
			});
			const engine = new TimerEngine(state, makeSettings());

			expect(engine.getProgress()).toBe(1);
		});

		it('freezes progress when paused', () => {
			vi.setSystemTime(new Date('2026-03-09T14:15:00'));

			const state = makeState({
				isRunning: true,
				isPaused: true,
				startTime: new Date('2026-03-09T14:00:00').getTime(),
				endTime: new Date('2026-03-09T14:30:00').getTime(),
				pausedRemaining: 15 * 60 * 1000,
			});
			const engine = new TimerEngine(state, makeSettings());

			const p = engine.getProgress();
			vi.setSystemTime(new Date('2026-03-09T14:25:00'));
			expect(engine.getProgress()).toBe(p);
		});
	});

	describe('pomodoro mode', () => {
		it('startPomodoro sets running state without snap alignment', () => {
			const engine = new TimerEngine(makeState(), makeSettings({ timerMode: 'pomodoro' }));
			engine.startPomodoro('task-1');

			const state = engine.getState();
			expect(state.isRunning).toBe(true);
			expect(state.isBreak).toBe(false);
			expect(state.currentTaskId).toBe('task-1');
		});

		it('completePomodoroWork increments count and starts break', () => {
			const engine = new TimerEngine(makeState(), makeSettings({
				timerMode: 'pomodoro',
				pomodoroWorkMinutes: 25,
				pomodoroBreakMinutes: 5,
				pomodoroLongBreakInterval: 4,
			}));

			engine.startPomodoro('task-1');
			engine.completePomodoroWork();

			expect(engine.getPomodoroCount()).toBe(1);
			expect(engine.getState().isBreak).toBe(true);
			expect(engine.getState().isRunning).toBe(true);
		});

		it('completePomodoroBreak stops the timer', () => {
			const breakSpy = vi.fn();
			const engine = new TimerEngine(makeState(), makeSettings({ timerMode: 'pomodoro' }));
			engine.onBreakCompleteCallback(breakSpy);

			engine.startPomodoro('task-1');
			engine.completePomodoroWork();
			engine.completePomodoroBreak();

			expect(engine.getState().isRunning).toBe(false);
			expect(engine.getState().isBreak).toBe(false);
			expect(breakSpy).toHaveBeenCalled();
		});

		it('resetPomodoroCount zeroes the counter', () => {
			const engine = new TimerEngine(makeState({ pomodoroCount: 5 }), makeSettings());
			engine.resetPomodoroCount();
			expect(engine.getPomodoroCount()).toBe(0);
		});
	});

	describe('state restore', () => {
		it('restoreFromState resumes a running timer', () => {
			const engine = new TimerEngine(makeState(), makeSettings());
			const saved = makeState({
				isRunning: true,
				isPaused: false,
				currentTaskId: 'restored',
				startTime: Date.now(),
				endTime: Date.now() + 30 * 60_000,
			});

			engine.restoreFromState(saved);
			expect(engine.getState().currentTaskId).toBe('restored');
			expect(engine.getState().isRunning).toBe(true);
		});

		it('restoreFromState does not start interval for paused timer', () => {
			const engine = new TimerEngine(makeState(), makeSettings());
			const saved = makeState({
				isRunning: true,
				isPaused: true,
				pausedRemaining: 10 * 60_000,
			});

			engine.restoreFromState(saved);
			expect(window.setInterval).not.toHaveBeenCalled();
		});
	});

	describe('event bus integration', () => {
		it('emits timer:complete on stop', () => {
			const bus = new EventBus();
			const spy = vi.fn();
			bus.on('timer:complete', spy);

			const engine = new TimerEngine(makeState(), makeSettings(), bus);
			engine.start('task-1', 30);
			engine.stop();

			expect(spy).toHaveBeenCalledWith(
				expect.objectContaining({ taskId: 'task-1' }),
			);
		});

		it('emits timer:state-change on start', () => {
			const bus = new EventBus();
			const spy = vi.fn();
			bus.on('timer:state-change', spy);

			const engine = new TimerEngine(makeState(), makeSettings(), bus);
			engine.start('task-1', 30);

			expect(spy).toHaveBeenCalled();
		});
	});
});
