/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard Welcome
 * Description: Timer circle display with SVG ring, task info, rollover, and pause/resume/complete controls
 * Created: 2026-03-07
 * Last Modified: 2026-03-07
 */

import { App, setIcon } from 'obsidian';
import { Task, PluginSettings } from '../types';
import { TimerEngine } from '../TimerEngine';
import { TaskManager } from '../TaskManager';
import { ConfirmStartModal } from '../modals/ConfirmStartModal';

export interface TimerSectionDeps {
	app: App;
	timerEngine: TimerEngine;
	taskManager: TaskManager;
	onRenderAll: () => void;
	saveCallback: () => void;
	settings: PluginSettings;
}

export class TimerSection {
	private deps: TimerSectionDeps;
	private displayEl: HTMLElement | null = null;
	private ringEl: SVGCircleElement | null = null;

	constructor(deps: TimerSectionDeps) {
		this.deps = deps;
	}

	getDisplayEl(): HTMLElement | null {
		return this.displayEl;
	}

	getRingEl(): SVGCircleElement | null {
		return this.ringEl;
	}

	render(parent: HTMLElement): void {
		const section = parent.createDiv({ cls: 'vw-timer-section' });

		const circle = section.createDiv({ cls: 'vw-timer-circle' });
		const svg = circle.createSvg('svg');
		svg.setAttribute('viewBox', '0 0 80 80');

		const bg = svg.createSvg('circle');
		bg.setAttribute('cx', '40');
		bg.setAttribute('cy', '40');
		bg.setAttribute('r', '36');
		bg.setAttribute('class', 'vw-timer-bg');

		const ring = svg.createSvg('circle');
		ring.setAttribute('cx', '40');
		ring.setAttribute('cy', '40');
		ring.setAttribute('r', '36');
		const ringCls = this.deps.timerEngine.isOnBreak() ? 'vw-timer-ring vw-timer-ring-break' : 'vw-timer-ring';
		ring.setAttribute('class', ringCls);
		const circumference = 2 * Math.PI * 36;
		ring.style.strokeDasharray = String(circumference);
		ring.style.strokeDashoffset = String(circumference);
		this.ringEl = ring;

		const displayWrap = circle.createDiv({ cls: 'vw-timer-display-wrap' });

		if (this.deps.timerEngine.isPomodoroMode()) {
			const pomState = this.deps.timerEngine.getState();
			const pomCount = this.deps.timerEngine.getPomodoroCount();
			const interval = this.deps.settings.pomodoroLongBreakInterval;
			if (pomCount > 0 || pomState.isRunning) {
				const dotsEl = displayWrap.createDiv({ cls: 'vw-pomodoro-dots vw-pomodoro-dots-circle' });
				const cyclePos = pomCount % interval;
				for (let i = 0; i < interval; i++) {
					const dot = dotsEl.createSpan({ cls: 'vw-pomodoro-dot' });
					if (i < cyclePos) dot.addClass('vw-pomodoro-dot-filled');
				}
				dotsEl.createSpan({ cls: 'vw-pomodoro-count', text: `${pomCount}` });
			}
		}

		const display = displayWrap.createDiv({ cls: 'vw-timer-display' });
		display.setText(this.deps.timerEngine.formatRemaining());
		this.displayEl = display;

		if (this.deps.timerEngine.isOnBreak()) {
			displayWrap.createDiv({ cls: 'vw-timer-break-label', text: 'Break' });
		}

		const modeLabel = this.deps.timerEngine.isPomodoroMode() ? 'Pomodoro' : 'Clock-Aligned';
		const modeIcon = this.deps.timerEngine.isPomodoroMode() ? 'timer' : 'clock';
		const modeTextEl = displayWrap.createDiv({ cls: 'vw-timer-mode-text' });
		const modeIconEl = modeTextEl.createSpan({ cls: 'vw-timer-mode-icon' });
		setIcon(modeIconEl, modeIcon);
		modeTextEl.createSpan({ text: modeLabel });
		modeTextEl.addEventListener('click', () => {
			this.deps.settings.timerMode = this.deps.timerEngine.isPomodoroMode() ? 'clock-aligned' : 'pomodoro';
			this.deps.saveCallback();
			this.deps.onRenderAll();
		});

		const content = section.createDiv({ cls: 'vw-timer-content' });
		const info = content.createDiv({ cls: 'vw-timer-info' });

		const state = this.deps.timerEngine.getState();
		const activeTask = state.currentTaskId ? this.deps.taskManager.getTask(state.currentTaskId) : null;
		const titleText = activeTask ? activeTask.title : 'No Active Task';
		info.createDiv({ cls: 'vw-timer-task-title', text: titleText });

		if (state.isRunning) {
			if (this.deps.timerEngine.isOnBreak()) {
				info.createDiv({ cls: 'vw-timer-next-task', text: 'Take a break' });
			} else {
				const endStr = this.deps.timerEngine.getEndTimeFormatted();
				info.createDiv({ cls: 'vw-timer-next-task', text: `Ends at ${endStr}` });
			}
			const nextTask = this.deps.taskManager.getNextPendingTask();
			if (nextTask) {
				info.createDiv({ cls: 'vw-timer-next-task', text: `Up next: ${nextTask.title}` });
			}
		} else {
			info.createDiv({ cls: 'vw-timer-next-task', text: 'Start a task to begin' });
		}

		const rollover = this.deps.timerEngine.getRolloverBalance();
		if (rollover !== 0 && this.deps.timerEngine.isPomodoroMode() === false) {
			const rolloverEl = info.createDiv({ cls: 'vw-timer-rollover vw-timer-rollover-clickable' });
			const sign = rollover > 0 ? '+' : '';
			const absMin = Math.abs(rollover);
			const h = Math.floor(absMin / 60);
			const m = Math.round(absMin % 60);
			const formatted = h > 0 ? `${h}h ${m}m` : `${m}m`;
			rolloverEl.setText(`Rollover: ${sign}${rollover < 0 ? '-' : ''}${formatted}`);
			rolloverEl.addClass(rollover > 0 ? 'vw-timer-rollover-positive' : 'vw-timer-rollover-negative');
			rolloverEl.setAttribute('aria-label', 'Click to reset rollover');
			rolloverEl.setAttribute('tabindex', '0');
			rolloverEl.addEventListener('click', () => {
				this.deps.timerEngine.resetRollover();
				this.deps.onRenderAll();
			});
		}


		const controls = content.createDiv({ cls: 'vw-timer-controls' });

		if (state.isRunning) {
			if (state.isPaused) {
				const resumeBtn = controls.createDiv({ cls: 'vw-timer-ctrl vw-timer-ctrl-primary' });
				setIcon(resumeBtn, 'play');
				resumeBtn.setAttribute('aria-label', 'Resume');
				resumeBtn.setAttribute('tabindex', '0');
				resumeBtn.addEventListener('click', () => {
					this.deps.timerEngine.resume();
					this.deps.onRenderAll();
				});
			} else {
				const pauseBtn = controls.createDiv({ cls: 'vw-timer-ctrl' });
				setIcon(pauseBtn, 'pause');
				pauseBtn.setAttribute('aria-label', 'Pause');
				pauseBtn.setAttribute('tabindex', '0');
				pauseBtn.addEventListener('click', () => {
					this.deps.timerEngine.pause();
					this.deps.onRenderAll();
				});
			}

			if (this.deps.timerEngine.isOnBreak()) {
				const skipBreakBtn = controls.createDiv({ cls: 'vw-timer-ctrl' });
				setIcon(skipBreakBtn, 'skip-forward');
				skipBreakBtn.setAttribute('aria-label', 'Skip break');
				skipBreakBtn.setAttribute('tabindex', '0');
				skipBreakBtn.addEventListener('click', () => {
					this.deps.timerEngine.completePomodoroBreak();
					this.deps.onRenderAll();
				});
			} else {
				const completeBtn = controls.createDiv({ cls: 'vw-timer-ctrl' });
				setIcon(completeBtn, 'check');
				completeBtn.setAttribute('aria-label', 'Complete');
				completeBtn.setAttribute('tabindex', '0');
				completeBtn.addEventListener('click', () => {
					if (this.deps.timerEngine.isPomodoroMode()) {
						this.deps.timerEngine.completePomodoroWork();
					} else {
						this.deps.timerEngine.stop();
					}
				});

				const restartBtn = controls.createDiv({ cls: 'vw-timer-ctrl' });
				setIcon(restartBtn, 'rotate-ccw');
				restartBtn.setAttribute('aria-label', 'Restart');
				restartBtn.setAttribute('tabindex', '0');
				restartBtn.addEventListener('click', () => {
					this.handleRestartActive();
				});

				const skipBtn = controls.createDiv({ cls: 'vw-timer-ctrl' });
				setIcon(skipBtn, 'skip-forward');
				skipBtn.setAttribute('aria-label', 'Skip');
				skipBtn.setAttribute('tabindex', '0');
				skipBtn.addEventListener('click', () => {
					this.handleSkipActive();
				});
			}
		}

		this.updateDisplay();
	}

	handleRestartActive(): void {
		const state = this.deps.timerEngine.getState();
		if (state.isRunning === false || state.currentTaskId === null) return;

		const task = this.deps.taskManager.getTask(state.currentTaskId);
		if (task === undefined) return;

		this.deps.timerEngine.cancel();
		this.deps.timerEngine.resetRollover();
		this.deps.taskManager.resetToPending(task.id);
		this.deps.saveCallback();
		this.deps.onRenderAll();
	}

	handleSkipActive(): void {
		const state = this.deps.timerEngine.getState();
		if (state.isRunning === false || state.currentTaskId === null) return;

		this.deps.taskManager.skipTask(state.currentTaskId);
		this.deps.timerEngine.cancel();
		this.deps.saveCallback();
		this.deps.onRenderAll();
	}

	handleRestartCompleted(task: Task): void {
		this.deps.taskManager.resetToPending(task.id);
		this.deps.saveCallback();
		this.deps.onRenderAll();
	}

	handleStartTask(task: Task): void {
		const state = this.deps.timerEngine.getState();

		if (state.isRunning && state.currentTaskId) {
			const activeTask = this.deps.taskManager.getTask(state.currentTaskId);
			const activeTitle = activeTask ? activeTask.title : 'Current task';

			new ConfirmStartModal(this.deps.app, activeTitle, task.title, (choice) => {
				if (choice === 'start-now') {
					this.overrideAndStart(task);
				} else if (choice === 'queue-next') {
					this.deps.taskManager.moveToFront(task.id);
					this.deps.saveCallback();
					this.deps.onRenderAll();
				}
			}).open();
			return;
		}

		this.startTaskImmediate(task);
	}

	private overrideAndStart(task: Task): void {
		const state = this.deps.timerEngine.getState();
		if (state.isRunning && state.currentTaskId) {
			const rollover = this.deps.timerEngine.getTaskRollover();
			this.deps.taskManager.completeTask(state.currentTaskId, Date.now());
			this.deps.timerEngine.cancel();
			this.deps.timerEngine.addRollover(rollover);
		}
		this.startTaskImmediate(task);
	}

	private startTaskImmediate(task: Task): void {
		if (this.deps.timerEngine.isPomodoroMode()) {
			this.deps.taskManager.startTask(task.id, 0);
			this.deps.timerEngine.startPomodoro(task.id);
		} else {
			const balance = this.deps.timerEngine.getRolloverBalance();
			this.deps.taskManager.startTask(task.id, balance);
			this.deps.timerEngine.start(task.id, task.durationMinutes);
		}
		this.deps.saveCallback();
		this.deps.onRenderAll();
	}

	updateDisplay(): void {
		if (this.displayEl) {
			const text = this.deps.timerEngine.formatRemaining();
			this.displayEl.setText(text);
			this.displayEl.toggleClass('vw-timer-negative', this.deps.timerEngine.isNegative());
		}

		if (this.ringEl) {
			const circumference = 2 * Math.PI * 36;
			const progress = this.deps.timerEngine.getProgress();
			const offset = circumference * (1 - progress);
			this.ringEl.style.strokeDashoffset = String(offset);
			this.ringEl.toggleClass('vw-timer-negative', this.deps.timerEngine.isNegative());
		}
	}
}
