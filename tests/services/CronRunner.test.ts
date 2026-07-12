/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vaultboard
 * Description: Tests for generated cron config note AI metadata
 * Created: 2026-05-14
 * Last Modified: 2026-05-16
 */

import { describe, expect, it } from 'vitest';
import { AI_TOOL, DEFAULT_SETTINGS, type PluginSettings } from '../../src/core/types';
import { createCronConfigNote } from '../../src/services/CronRunner';

/** Creates isolated settings so provider metadata tests do not mutate defaults. */
const makeSettings = (): PluginSettings => JSON.parse(JSON.stringify(DEFAULT_SETTINGS));

describe('createCronConfigNote', () => {
	it('writes provider-specific AI metadata for Codex dispatches', () => {
		const settings = makeSettings();
		settings.aiTool = AI_TOOL.CODEX_CLI;
		settings.aiProviders.codexCli.cliPath = '/opt/homebrew/bin/codex';
		settings.aiProviders.codexCli.model = 'gpt-5.4';
		const note = createCronConfigNote(DEFAULT_SETTINGS.cronJobs[0], settings);

		expect(note).toContain('ai_tool: "codex-cli"');
		expect(note).toContain('ai_provider_model: "gpt-5.4"');
		expect(note).toContain('ai_tool_path: "/opt/homebrew/bin/codex"');
		expect(note).toContain('openrouter_base_url: "https://openrouter.ai/api/v1"');
	});

	it('writes OpenRouter model metadata without leaking API key references', () => {
		const settings = makeSettings();
		settings.aiTool = AI_TOOL.OPENROUTER;
		settings.aiProviders.openRouter.model = 'openai/gpt-5.4';
		const note = createCronConfigNote(DEFAULT_SETTINGS.cronJobs[0], settings);

		expect(note).toContain('ai_tool: "openrouter"');
		expect(note).toContain('ai_provider_model: "openai/gpt-5.4"');
		expect(note).toContain('ai_tool_path: ""');
		expect(note).not.toContain('api-key');
	});
});
