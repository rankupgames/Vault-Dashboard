import { describe, it, expect } from 'vitest';
import {
	AI_TOOL,
	CRON_FREQUENCY,
	DEFAULT_AI_PROVIDERS,
	DEFAULT_SETTINGS,
	IMAGE_EXTENSIONS,
	isImageExtension,
} from '../../src/core/types';

describe('IMAGE_EXTENSIONS', () => {
	it('contains expected formats', () => {
		expect(IMAGE_EXTENSIONS).toContain('png');
		expect(IMAGE_EXTENSIONS).toContain('jpg');
		expect(IMAGE_EXTENSIONS).toContain('jpeg');
		expect(IMAGE_EXTENSIONS).toContain('gif');
		expect(IMAGE_EXTENSIONS).toContain('svg');
		expect(IMAGE_EXTENSIONS).toContain('webp');
	});

	it('has exactly 6 supported formats', () => {
		expect(IMAGE_EXTENSIONS).toHaveLength(6);
	});
});

describe('isImageExtension', () => {
	it('returns true for known image extensions', () => {
		expect(isImageExtension('png')).toBe(true);
		expect(isImageExtension('jpg')).toBe(true);
		expect(isImageExtension('jpeg')).toBe(true);
		expect(isImageExtension('gif')).toBe(true);
		expect(isImageExtension('svg')).toBe(true);
		expect(isImageExtension('webp')).toBe(true);
	});

	it('is case-insensitive', () => {
		expect(isImageExtension('PNG')).toBe(true);
		expect(isImageExtension('Jpg')).toBe(true);
		expect(isImageExtension('WEBP')).toBe(true);
	});

	it('returns false for non-image extensions', () => {
		expect(isImageExtension('md')).toBe(false);
		expect(isImageExtension('txt')).toBe(false);
		expect(isImageExtension('pdf')).toBe(false);
		expect(isImageExtension('ts')).toBe(false);
		expect(isImageExtension('')).toBe(false);
	});
});

describe('DEFAULT_SETTINGS modules', () => {
	it('includes latest markdown files near quick access', () => {
		const ids = DEFAULT_SETTINGS.modules.map((module) => module.id);
		expect(ids.indexOf('latest-markdown')).toBeGreaterThan(ids.indexOf('quick-access'));
		expect(ids.indexOf('latest-markdown')).toBeLessThan(ids.indexOf('daily-reports'));
		expect(DEFAULT_SETTINGS.modules.find((module) => module.id === 'latest-markdown')?.enabled).toBe(true);
	});

	it('includes the crons module before weekly reports', () => {
		const ids = DEFAULT_SETTINGS.modules.map((module) => module.id);
		expect(ids.indexOf('crons')).toBeGreaterThan(ids.indexOf('gmail-intelligence'));
		expect(ids.indexOf('crons')).toBeLessThan(ids.indexOf('weekly-reports'));
		expect(DEFAULT_SETTINGS.modules.find((module) => module.id === 'crons')?.enabled).toBe(true);
	});

	it('uses date-scoped patterns for built-in report sources', () => {
		for (const source of DEFAULT_SETTINGS.reportSources) {
			expect(source.patternStr).toContain('(\\d{4}-\\d{2}-\\d{2})');
		}
	});

	it('uses consolidated daily and weekly report sources', () => {
		expect(DEFAULT_SETTINGS.reportSources.map((source) => source.id)).toEqual(['daily-report', 'weekly-report']);
	});

	it('includes dashboard-managed default cron jobs', () => {
		expect(DEFAULT_SETTINGS.cronJobs.map((job) => job.id)).toEqual(['daily-report', 'weekly-report']);
		expect(DEFAULT_SETTINGS.cronJobs[0].frequency).toBe(CRON_FREQUENCY.DAILY);
		expect(DEFAULT_SETTINGS.cronJobs[1].frequency).toBe(CRON_FREQUENCY.WEEKLY);
	});

	it('keeps Gmail digest paths user-configurable by default', () => {
		expect(DEFAULT_SETTINGS.gmailDigest.pythonPath).toBe('');
		expect(DEFAULT_SETTINGS.gmailDigest.scriptPath).toBe('');
		expect(DEFAULT_SETTINGS.gmailDigest.workingDirectory).toBe('');
		expect(DEFAULT_SETTINGS.gmailDigest.query).toBe('in:anywhere newer_than:7d');
		expect(DEFAULT_SETTINGS.gmailDigest.limit).toBe(500);
		expect(DEFAULT_SETTINGS.gmailDigest.digestDate).toBe('today');
	});

	it('defaults AI integration to disabled with provider-specific Keychain refs', () => {
		expect(DEFAULT_SETTINGS.aiTool).toBe(AI_TOOL.NONE);
		expect(DEFAULT_SETTINGS.aiProviders.cursorSdk.apiKey).toEqual(DEFAULT_AI_PROVIDERS.cursorSdk.apiKey);
		expect(DEFAULT_SETTINGS.aiProviders.cursorSdk.apiKey).toEqual({ service: 'orbit', account: 'cursor-api-key' });
		expect(DEFAULT_SETTINGS.aiProviders.codexCli.apiKey.account).toBe('codex-cli:api-key');
		expect(DEFAULT_SETTINGS.aiProviders.claudeCode.apiKey.account).toBe('claude-code:api-key');
		expect(DEFAULT_SETTINGS.aiProviders.openRouter.apiKey.account).toBe('openrouter:api-key');
		expect(DEFAULT_SETTINGS.aiProviders.openRouter.baseUrl).toBe('https://openrouter.ai/api/v1');
	});
});
