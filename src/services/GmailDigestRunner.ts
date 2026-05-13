/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard
 * Description: Read-only Gmail digest command resolution and dispatch helpers
 * Created: 2026-05-13
 * Last Modified: 2026-05-13
 */

import { App } from 'obsidian';
import { GmailDigestSettings, ReportSource } from '../core/types';

const GMAIL_DIGEST_TOOL_RELATIVE_PATH = ['Tools', 'gmail-vault-digest', 'gmail_vault_digest.py'];
const GMAIL_DIGEST_VENV_RELATIVE_PATH = ['.local', 'share', 'gmail-vault-digest', 'venv', 'bin', 'python3'];

export const GMAIL_INTELLIGENCE_BASE_PATH = 'WorkspaceVault/Business/Operations/Gmail Intelligence';
export const GMAIL_SETUP_PATH = `${GMAIL_INTELLIGENCE_BASE_PATH}/Gmail_Intelligence_Setup.md`;
export const GMAIL_DIGEST_SOURCE: ReportSource = {
	id: 'gmail-digests',
	label: 'Analysis Digests',
	folder: `${GMAIL_INTELLIGENCE_BASE_PATH}/Digests`,
	pattern: /^Gmail_Digest_(\d{4}-\d{2}-\d{2})\.md$/,
	frequency: 'daily',
};

/** Resolved command paths for local Gmail tool execution. */
export interface GmailDigestCommandPaths {
	/** Python executable used to run the digest script. */
	python: string;
	/** Local path to the Gmail digest script. */
	script: string;
	/** Working directory used for the spawned process and AI dispatch takeover. */
	workingDirectory: string;
	/** Absolute Obsidian vault root passed to the Python tool. */
	vaultRoot: string;
	/** Absolute output folder for Gmail analysis markdown. */
	outputRoot: string;
}

export type GmailLaunchdCommand = 'launchd-status' | 'enable-launchd' | 'disable-launchd';

/** Returns true when Obsidian is running with Node APIs available. */
const isDesktopNodeRuntime = (): boolean =>
	typeof process !== 'undefined' && process.versions?.node !== undefined && typeof require === 'function';

/** Uses settings, environment overrides, then repo-relative defaults to locate the Gmail digest tool. */
export const resolveGmailDigestCommandPaths = (app: App, settings: GmailDigestSettings): GmailDigestCommandPaths => {
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const path = require('path') as typeof import('path');
	const vaultRoot = (app.vault.adapter as { basePath?: string }).basePath ?? process.cwd();
	const repoRoot = path.dirname(vaultRoot);
	const home = process.env.HOME ?? process.cwd();

	return {
		python: nonEmpty(settings.pythonPath)
			?? process.env.GMAIL_VAULT_PYTHON
			?? path.join(home, ...GMAIL_DIGEST_VENV_RELATIVE_PATH),
		script: nonEmpty(settings.scriptPath)
			?? process.env.GMAIL_VAULT_SCRIPT
			?? path.join(repoRoot, ...GMAIL_DIGEST_TOOL_RELATIVE_PATH),
		workingDirectory: nonEmpty(settings.workingDirectory)
			?? process.env.GMAIL_VAULT_WORKING_DIR
			?? repoRoot,
		vaultRoot,
		outputRoot: path.join(vaultRoot, GMAIL_INTELLIGENCE_BASE_PATH),
	};
};

/** Runs a Gmail digest tool command with vault/output roots supplied explicitly. */
export const runGmailToolCommand = (
	app: App,
	settings: GmailDigestSettings,
	commandArgs: string[],
): Promise<string> => {
	if (isDesktopNodeRuntime() === false) {
		return Promise.reject(new Error('Gmail commands can only run in Obsidian desktop.'));
	}

	return new Promise((resolve, reject) => {
		const paths = resolveGmailDigestCommandPaths(app, settings);
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const { spawn } = require('child_process') as typeof import('child_process');
		const child = spawn(
			paths.python,
			[
				paths.script,
				'--vault-root',
				paths.vaultRoot,
				'--output-root',
				paths.outputRoot,
				...commandArgs,
			],
			{
				cwd: paths.workingDirectory,
				stdio: ['ignore', 'pipe', 'pipe'],
			},
		);

		const standardOutputChunks: Buffer[] = [];
		const standardErrorChunks: Buffer[] = [];
		child.stdout.on('data', (chunk: Buffer) => standardOutputChunks.push(chunk));
		child.stderr.on('data', (chunk: Buffer) => standardErrorChunks.push(chunk));
		child.on('error', (error: Error) => reject(error));
		child.on('close', (code: number | null) => {
			const standardOutput = Buffer.concat(standardOutputChunks).toString('utf-8');
			const standardError = Buffer.concat(standardErrorChunks).toString('utf-8');
			if (code === 0) {
				resolve(standardOutput);
				return;
			}
			reject(new Error(standardError.trim() || standardOutput.trim() || `Gmail command exited with code ${code ?? 'unknown'}.`));
		});
	});
};

/** Runs the one-time OAuth flow with read-only Gmail scope. */
export const runGmailOAuthSetup = (app: App, settings: GmailDigestSettings): Promise<void> =>
	runGmailToolCommand(app, settings, ['auth']).then(() => undefined);

/** Runs or checks the local launchd schedule using the configured query and limits. */
export const runGmailLaunchdCommand = (
	app: App,
	settings: GmailDigestSettings,
	command: GmailLaunchdCommand,
): Promise<string> => {
	if (command !== 'enable-launchd') {
		return runGmailToolCommand(app, settings, [command]);
	}

	const paths = resolveGmailDigestCommandPaths(app, settings);
	return runGmailToolCommand(app, settings, [
		command,
		'--python',
		paths.python,
		'--query',
		settings.query,
		'--limit',
		String(settings.limit),
		'--date',
		settings.digestDate,
	]);
};

/** Builds the read-only manual review prompt from the same settings used by the dashboard buttons. */
export const createGmailReviewPrompt = (
	paths: GmailDigestCommandPaths,
	settings: GmailDigestSettings,
): string => `Use the gmail-vault-digest skill to review the configured business Gmail.

Workflow:
1. Run the read-only tool doctor first:
   ${formatCommand(paths, ['doctor', '--strict-token'])}
2. Run the configured Gmail analysis command:
   ${formatCommand(paths, [
	'analyze',
	'--query',
	settings.query,
	'--limit',
	String(settings.limit),
	'--date',
	settings.digestDate,
])}
3. Inspect the generated Vault markdown under ${GMAIL_INTELLIGENCE_BASE_PATH}/.
4. Lead with concrete business actions: clients, money, scheduling, job pipeline, risks, replies to send, and follow-ups.

Safety:
- Never print OAuth credential or token contents.
- Do not request send/delete/modify Gmail scopes.
- Do not send, delete, archive, label, or otherwise modify email.
- Summarize what matters and cite the local Vault note paths you used.`;

const formatCommand = (paths: GmailDigestCommandPaths, commandArgs: string[]): string =>
	[
		paths.python,
		paths.script,
		'--vault-root',
		paths.vaultRoot,
		'--output-root',
		paths.outputRoot,
		...commandArgs,
	].map(quoteForPrompt).join(' ');

const quoteForPrompt = (value: string): string =>
	/[\s"'$`\\]/.test(value) ? `'${value.replace(/'/g, "'\\''")}'` : value;

const nonEmpty = (value: string): string | null => {
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
};
