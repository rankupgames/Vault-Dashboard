/** Provider request phases that determine local execution permissions. */
export const AI_DISPATCH_PHASE = {
	DISPATCH: 'dispatch',
	PLAN: 'plan',
	EXECUTE: 'execute',
} as const;

/** Runtime phase for one provider request. */
export type AIDispatchPhase = (typeof AI_DISPATCH_PHASE)[keyof typeof AI_DISPATCH_PHASE];
