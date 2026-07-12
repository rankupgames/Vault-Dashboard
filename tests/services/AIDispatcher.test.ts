/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vaultboard
 * Description: Security-focused tests for AI provider dispatch helpers
 * Created: 2026-05-16
 * Last Modified: 2026-05-16
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AI_TOOL, DEFAULT_SETTINGS, type PluginSettings } from '../../src/core/types';
import {
	AI_DISPATCH_PHASE,
	AIDispatcher,
	normalizeOpenRouterBaseUrl,
	redactSensitiveText,
	type AIDispatchPhase,
} from '../../src/services/AIDispatcher';

const { getKeychainSecretMock, requestUrlMock } = vi.hoisted(() => ({
	getKeychainSecretMock: vi.fn(),
	requestUrlMock: vi.fn(),
}));

vi.mock('obsidian', async (importOriginal) => ({
	...await importOriginal<typeof import('obsidian')>(),
	requestUrl: requestUrlMock,
}));

vi.mock('../../src/services/KeychainSecrets', () => ({
	getKeychainSecret: getKeychainSecretMock,
}));

/** Test harness for private argument building without widening production visibility. */
interface AIDispatcherHarness {
	/** Builds CLI arguments for a local provider. */
	buildCliArgs(
		settings: PluginSettings,
		tool: typeof AI_TOOL.CODEX_CLI | typeof AI_TOOL.CLAUDE_CODE,
		phase: AIDispatchPhase,
		promptContent: string,
	): string[];
}

/** Creates an isolated settings object so tests can mutate provider settings safely. */
const makeSettings = (): PluginSettings => JSON.parse(JSON.stringify(DEFAULT_SETTINGS));

beforeEach(() => {
	getKeychainSecretMock.mockReset();
	requestUrlMock.mockReset();
});

describe('AIDispatcher CLI permissions', () => {
	it('does not force Codex dangerous sandbox bypass during execute when skip permissions is disabled', () => {
		const settings = makeSettings();
		settings.aiTool = AI_TOOL.CODEX_CLI;
		settings.aiSkipPermissions = false;

		const dispatcher = new AIDispatcher() as unknown as AIDispatcherHarness;
		const args = dispatcher.buildCliArgs(settings, AI_TOOL.CODEX_CLI, AI_DISPATCH_PHASE.EXECUTE, 'approved plan');

		expect(args).not.toContain('--dangerously-bypass-approvals-and-sandbox');
		expect(args).toContain('--sandbox');
		expect(args).toContain('workspace-write');
	});

	it('only includes Codex dangerous sandbox bypass when skip permissions is enabled', () => {
		const settings = makeSettings();
		settings.aiTool = AI_TOOL.CODEX_CLI;
		settings.aiSkipPermissions = true;

		const dispatcher = new AIDispatcher() as unknown as AIDispatcherHarness;
		const args = dispatcher.buildCliArgs(settings, AI_TOOL.CODEX_CLI, AI_DISPATCH_PHASE.PLAN, 'plan');

		expect(args).toContain('--dangerously-bypass-approvals-and-sandbox');
		expect(args).not.toContain('--sandbox');
	});
});

describe('OpenRouter URL validation', () => {
	it('normalizes safe HTTPS base URLs', () => {
		expect(normalizeOpenRouterBaseUrl('https://openrouter.ai/api/v1/')).toBe('https://openrouter.ai/api/v1');
		expect(normalizeOpenRouterBaseUrl('')).toBe('https://openrouter.ai/api/v1');
	});

	it('rejects unsafe base URLs before provider API keys are sent', () => {
		expect(() => normalizeOpenRouterBaseUrl('http://openrouter.ai/api/v1')).toThrow('HTTPS');
		expect(() => normalizeOpenRouterBaseUrl('https://user:pass@openrouter.ai/api/v1')).toThrow('credentials');
		expect(() => normalizeOpenRouterBaseUrl('https://openrouter.ai/api/v1?token=abc')).toThrow('query');
		expect(() => normalizeOpenRouterBaseUrl('not a url')).toThrow('valid HTTPS URL');
	});
});

describe('provider error redaction', () => {
	it('redacts common API key and Authorization formats from provider text', () => {
		const authorizationHeader = 'Authorization';
		const environmentVariableName = 'OPENAI_API_KEY';
		const text = `${authorizationHeader}: Bearer provider-token-value\n${environmentVariableName}=provider-token-value`;

		expect(redactSensitiveText(text)).not.toContain('provider-token-value');
		expect(redactSensitiveText(text)).toContain('Authorization: Bearer [redacted]');
		expect(redactSensitiveText(text)).toContain('OPENAI_API_KEY=[redacted]');
	});
});

describe('OpenRouter Obsidian requests', () => {
	it('loads models through requestUrl without automatic HTTP status throws', async () => {
		const settings = makeSettings();
		settings.aiTool = AI_TOOL.OPENROUTER;
		settings.aiProviders.openRouter.apiKey = { source: 'keychain', account: 'openrouter' };
		getKeychainSecretMock.mockResolvedValue('provider-token-value');
		requestUrlMock.mockResolvedValue({
			status: 200,
			headers: {},
			arrayBuffer: new ArrayBuffer(0),
			json: { data: [{ id: 'test/model', name: 'Test Model' }] },
			text: JSON.stringify({ data: [{ id: 'test/model', name: 'Test Model' }] }),
		});

		const models = await new AIDispatcher().refreshModels(settings);

		expect(models).toEqual([{ id: 'test/model', name: 'Test Model' }]);
		expect(requestUrlMock).toHaveBeenCalledWith(expect.objectContaining({
			url: 'https://openrouter.ai/api/v1/models/user',
			headers: expect.objectContaining({
				'HTTP-Referer': 'https://github.com/rankupgames/Vault-Dashboard',
				'X-Title': 'Vaultboard',
			}),
			throw: false,
		}));
	});

	it('preserves redacted provider errors from non-2xx requestUrl responses', async () => {
		const settings = makeSettings();
		settings.aiTool = AI_TOOL.OPENROUTER;
		settings.aiProviders.openRouter.apiKey = { source: 'keychain', account: 'openrouter' };
		getKeychainSecretMock.mockResolvedValue('provider-token-value');
		requestUrlMock.mockResolvedValue({
			status: 401,
			headers: { 'Content-Length': '49' },
			arrayBuffer: new ArrayBuffer(0),
			json: {},
			text: 'Authorization: Bearer provider-token-value',
		});

		await expect(new AIDispatcher().refreshModels(settings))
			.rejects.toThrow('OpenRouter model refresh failed: 401 Authorization: Bearer [redacted]');
	});
});
