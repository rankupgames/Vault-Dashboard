/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard
 * Description: Event name constants and typed payload interfaces for the EventBus
 * Created: 2026-03-09
 * Last Modified: 2026-03-09
 */

import { Task, TimerState } from './types';

/** Timer-related event names. */
export const TimerEvents = {
	Tick: 'timer:tick',
	Complete: 'timer:complete',
	BreakComplete: 'timer:break-complete',
	StateChange: 'timer:state-change',
} as const;

/** Task-related event names. */
export const TaskEvents = {
	Start: 'task:start',
	Complete: 'task:complete',
	Skip: 'task:skip',
	Changed: 'task:changed',
} as const;

/** View-related event names. */
export const ViewEvents = {
	RenderAll: 'view:render-all',
	Save: 'view:save',
} as const;

/** Audio-related event names. */
export const AudioEvents = {
	PlayComplete: 'audio:play-complete',
	PlayWarning: 'audio:play-warning',
} as const;

/** Payload for timer tick events. */
export interface TimerTickPayload {
	/** Remaining milliseconds. */
	remaining: number;
	/** Whether the timer has gone negative. */
	isNegative: boolean;
}

/** Payload for timer complete events. */
export interface TimerCompletePayload {
	/** ID of the completed task. */
	taskId: string;
	/** Rollover minutes to apply to next task. */
	rollover: number;
}

/** Payload for pomodoro break complete events. */
export interface TimerBreakCompletePayload {
	/** Whether the completed break was a long break. */
	isLongBreak: boolean;
}

/** Payload for timer state change events. */
export interface TimerStateChangePayload {
	/** Current timer state snapshot. */
	state: TimerState;
}

/** Payload for task start events. */
export interface TaskStartPayload {
	/** The task that was started. */
	task: Task;
}

/** Payload for task complete events. */
export interface TaskCompletePayload {
	/** ID of the completed task. */
	taskId: string;
}

/** Payload for task skip events. */
export interface TaskSkipPayload {
	/** ID of the skipped task. */
	taskId: string;
}
