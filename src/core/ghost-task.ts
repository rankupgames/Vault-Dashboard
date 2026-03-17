/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard
 * Description: Ghost task utilities -- prefix-based identification and factory helpers
 * Created: 2026-03-17
 * Last Modified: 2026-03-17
 */

/** Prefix used to identify ghost task IDs in TimerState. */
export const GHOST_PREFIX = 'ghost:';

/** Metadata for a ghost task (timer-only, no task card). */
export interface GhostTaskInfo {
	name: string;
	durationMinutes: number;
}

/** Returns true when the given task ID belongs to a ghost task. */
export const isGhostTaskId = (id: string | null): boolean =>
	id !== null && id.startsWith(GHOST_PREFIX);

/** Creates a unique ghost task ID using the current timestamp. */
export const createGhostTaskId = (): string =>
	`${GHOST_PREFIX}${Date.now()}`;
