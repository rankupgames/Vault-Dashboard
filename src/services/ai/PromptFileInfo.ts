/** Prompt content and filesystem paths shared by provider runners. */
export interface PromptFileInfo {
	/** Absolute vault root used for terminal and IDE handoff. */
	vaultPath: string;
	/** Markdown prompt sent directly to the selected provider. */
	promptContent: string;
	/** Working directory used by local provider processes. */
	execCwd: string;
}
