/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard
 * Description: Shared contract for modules that dispatch free-form prompts to the AI dispatcher
 * Created: 2026-05-12
 * Last Modified: 2026-05-12
 */

/** Minimal prompt dispatch contract used by dashboard modules. */
export interface PromptDispatchProvider {
	dispatchPrompt(title: string, prompt: string, workingDirectory?: string): Promise<string>;
}
