/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard
 * Description: Composable timer control state -- single source of truth for button visibility
 * Created: 2026-03-17
 * Last Modified: 2026-03-17
 */

import { TimerEngine } from './TimerEngine';
import { isGhostTaskId } from './ghost-task';

/** Which timer controls should be visible in the current state. */
export interface TimerControlState {
	showPause: boolean;
	showResume: boolean;
	showComplete: boolean;
	showRestart: boolean;
	showSkip: boolean;
	showSkipBreak: boolean;
	showGhostTask: boolean;
	showPopout: boolean;
}

/**
 * Derives the full set of timer control flags from the current engine state.
 * Consumed by TimerSection, MiniTimerView, and any future control surface.
 */
export const getTimerControlState = (engine: TimerEngine, hasPopout: boolean): TimerControlState => {
	const state = engine.getState();
	const running = state.isRunning;
	const paused = state.isPaused;
	const onBreak = engine.isOnBreak();
	const ghost = isGhostTaskId(state.currentTaskId);

	return {
		showPause: running && paused === false,
		showResume: running && paused,
		showComplete: running && onBreak === false,
		showRestart: running && onBreak === false,
		showSkip: running && onBreak === false && ghost === false,
		showSkipBreak: running && onBreak,
		showGhostTask: running === false,
		showPopout: hasPopout,
	};
};
