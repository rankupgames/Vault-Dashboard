import type { DispatchStatus } from '../../core/types';
import type { AIAction } from './AIAction';

/** In-memory snapshot of a running or completed provider dispatch. */
export interface DispatchRecord {
	/** Persisted identifier used by the sidebar and approval flow. */
	id: string;
	/** Task operation requested from the provider. */
	action: AIAction;
	/** User-facing dispatch label. */
	label: string;
	/** Associated task identifier, or an empty string for general prompts. */
	taskId: string;
	/** Associated task title, or an empty string for general prompts. */
	taskTitle: string;
	/** Provider identifier captured when the dispatch began. */
	tool: string;
	/** Current lifecycle status. */
	status: DispatchStatus;
	/** Dispatch start timestamp in milliseconds. */
	startTime: number;
	/** Terminal-state timestamp in milliseconds. */
	endTime?: number;
	/** Sanitized provider failure text. */
	error?: string;
	/** Provider output retained for the current runtime session. */
	output?: string;
	/** Legacy process identifier retained for record compatibility. */
	pid?: number;
	/** Absolute vault path used for terminal and IDE handoff. */
	vaultPath: string;
	/** Captured plan text awaiting explicit approval. */
	planText?: string;
	/** Originating plan identifier for separately persisted execution records. */
	parentPlanId?: string;
}
