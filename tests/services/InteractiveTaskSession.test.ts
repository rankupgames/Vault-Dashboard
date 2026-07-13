import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AI_TOOL, DEFAULT_SETTINGS, type AITool, type PluginSettings } from '../../src/core/types';
import { AIDispatcher } from '../../src/services/AIDispatcher';

const processMocks = vi.hoisted(() => ({
	spawn: vi.fn(),
	spawnSync: vi.fn(),
}));

vi.mock('child_process', () => ({
	spawn: processMocks.spawn,
	spawnSync: processMocks.spawnSync,
}));

/** Creates isolated provider settings for one launch assertion. */
const makeSettings = (): PluginSettings => JSON.parse(JSON.stringify(DEFAULT_SETTINGS));

beforeEach(() => {
	processMocks.spawn.mockReset();
	processMocks.spawnSync.mockReset();
	processMocks.spawn.mockReturnValue({});
	processMocks.spawnSync.mockReturnValue({ status: 0, stdout: '' });
});

describe('interactive task sessions', () => {
	it('launches Codex in Ghostty with cwd, model, and prompt as distinct argv', () => {
		const settings = makeSettings();
		settings.aiTool = AI_TOOL.CODEX_CLI;
		settings.terminalApp = 'ghostty';
		settings.aiProviders.codexCli.cliPath = '/opt/provider/bin/codex';
		settings.aiProviders.codexCli.model = 'gpt-test-model';
		const workingDirectory = "/tmp/Project's $(touch never)";
		const prompt = "--dangerously-bypass-approvals-and-sandbox; $(touch never) and preserve 'quotes'.";

		new AIDispatcher().openInteractiveTaskSession(settings, workingDirectory, prompt);

		expect(processMocks.spawn).toHaveBeenCalledWith('open', [
			'-na',
			'Ghostty.app',
			'--args',
			`--working-directory=${workingDirectory}`,
			'-e',
			'/opt/provider/bin/codex',
			'-C',
			workingDirectory,
			'--model',
			'gpt-test-model',
			'--',
			prompt,
		], { detached: true, stdio: 'ignore' });
		expect(processMocks.spawn.mock.calls[0]?.[2]).not.toHaveProperty('shell');
	});

	it('launches Claude in Terminal.app through a static quoted-form AppleScript', () => {
		const settings = makeSettings();
		settings.aiTool = AI_TOOL.CLAUDE_CODE;
		settings.terminalApp = 'terminal';
		settings.aiProviders.claudeCode.cliPath = '/opt/provider/bin/claude';
		settings.aiProviders.claudeCode.model = 'claude-test-model';
		const workingDirectory = "/tmp/Project's $(touch never)";
		const prompt = "--dangerously-skip-permissions; $(touch never) and preserve 'quotes'.";

		new AIDispatcher().openInteractiveTaskSession(settings, workingDirectory, prompt);

		expect(processMocks.spawn).toHaveBeenCalledOnce();
		const [command, args, options] = processMocks.spawn.mock.calls[0] as [string, string[], Record<string, unknown>];
		expect(command).toBe('osascript');
		expect(args.slice(2)).toEqual([
			'--',
			workingDirectory,
			'/opt/provider/bin/claude',
			'--model',
			'claude-test-model',
			'--',
			prompt,
		]);
		expect(args[0]).toBe('-e');
		expect(args[1]).toContain('quoted form of workingDirectory');
		expect(args[1]).toContain('quoted form of executablePath');
		expect(args[1]).toContain('quoted form of (item argumentIndex of argv)');
		expect(args[1]).not.toContain(workingDirectory);
		expect(args[1]).not.toContain(prompt);
		expect(options).toEqual({ detached: true, stdio: 'ignore' });
		expect(options).not.toHaveProperty('shell');
	});

	it.each([
		AI_TOOL.NONE,
		AI_TOOL.CURSOR_SDK,
		AI_TOOL.OPENROUTER,
	] as AITool[])('rejects unsupported provider %s without launching a fallback', (tool) => {
		const settings = makeSettings();
		settings.aiTool = tool;

		expect(() => new AIDispatcher().openInteractiveTaskSession(settings, '/tmp/project', 'Do work'))
			.toThrow('support only Codex CLI or Claude Code');
		expect(processMocks.spawn).not.toHaveBeenCalled();
	});

	it('rejects malformed CLI paths and missing launch inputs synchronously', () => {
		const settings = makeSettings();
		settings.aiTool = AI_TOOL.CODEX_CLI;
		settings.aiProviders.codexCli.cliPath = '/opt/codex;touch-pwned';
		const dispatcher = new AIDispatcher();

		expect(() => dispatcher.openInteractiveTaskSession(settings, '/tmp/project', 'Do work'))
			.toThrow('path contains invalid characters');
		settings.aiProviders.codexCli.cliPath = '/opt/codex';
		expect(() => dispatcher.openInteractiveTaskSession(settings, '   ', 'Do work'))
			.toThrow('require a working directory');
		expect(() => dispatcher.openInteractiveTaskSession(settings, '/tmp/project', '   '))
			.toThrow('require a prompt');
		expect(processMocks.spawn).not.toHaveBeenCalled();
	});
});
