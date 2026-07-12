import type { Task } from '../../core/types';

/** Vault task, document, and image data assembled for prompt generation. */
export interface AIContext {
	/** Active tasks visible to the provider. */
	tasks: Task[];
	/** Archived tasks included as historical context. */
	archivedTasks: Task[];
	/** Linked note contents keyed by vault-relative path. */
	linkedDocContents: Map<string, string>;
	/** Deduplicated vault-relative image paths referenced by tasks. */
	imagePaths: string[];
}
