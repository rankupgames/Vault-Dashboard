/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard
 * Description: Utilities for dashboard-managed launchd cron jobs
 * Created: 2026-05-13
 * Last Modified: 2026-05-13
 */

import { App } from 'obsidian';
import {
	CRON_FREQUENCY,
	CRON_WEEKDAY,
	CronJobConfig,
	CronWeekday,
	PluginSettings,
	ReportSource,
} from '../core/types';

const CRON_RUNNER_RELATIVE_PATH = ['Tools', 'vault-dashboard-cron', 'vault_cron_runner.py'];
const DEFAULT_CRON_BASE_PATH = 'WorkspaceVault/Personal/ClaudeCRON';

export const WEEKDAY_LABELS: Record<CronWeekday, string> = {
	[CRON_WEEKDAY.SUNDAY]: 'Sunday',
	[CRON_WEEKDAY.MONDAY]: 'Monday',
	[CRON_WEEKDAY.TUESDAY]: 'Tuesday',
	[CRON_WEEKDAY.WEDNESDAY]: 'Wednesday',
	[CRON_WEEKDAY.THURSDAY]: 'Thursday',
	[CRON_WEEKDAY.FRIDAY]: 'Friday',
	[CRON_WEEKDAY.SATURDAY]: 'Saturday',
};

interface CronRunnerPaths {
	python: string;
	script: string;
	vaultRoot: string;
}

export interface CronRunnerStatus {
	enabled: boolean;
	stdout: string;
}

const isDesktopNodeRuntime = (): boolean =>
	typeof process !== 'undefined' && process.versions?.node !== undefined && typeof require === 'function';

const resolveCronRunnerPaths = (app: App): CronRunnerPaths => {
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const path = require('path') as typeof import('path');
	const vaultRoot = (app.vault.adapter as { basePath?: string }).basePath ?? process.cwd();
	const repoRoot = path.dirname(vaultRoot);
	return {
		python: process.env.VAULT_DASHBOARD_CRON_PYTHON ?? 'python3',
		script: path.join(repoRoot, ...CRON_RUNNER_RELATIVE_PATH),
		vaultRoot,
	};
};

export const runCronRunnerCommand = (app: App, args: string[]): Promise<string> => {
	if (isDesktopNodeRuntime() === false) {
		return Promise.reject(new Error('Cron commands can only run in Obsidian desktop.'));
	}

	return new Promise((resolve, reject) => {
		const paths = resolveCronRunnerPaths(app);
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const { spawn } = require('child_process') as typeof import('child_process');
		const child = spawn(paths.python, [paths.script, '--vault-root', paths.vaultRoot, ...args], {
			cwd: paths.vaultRoot,
			stdio: ['ignore', 'pipe', 'pipe'],
		});

		const stdoutChunks: Buffer[] = [];
		const stderrChunks: Buffer[] = [];
		child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
		child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));
		child.on('error', (error: Error) => reject(error));
		child.on('close', (code: number | null) => {
			const stdout = Buffer.concat(stdoutChunks).toString('utf-8');
			const stderr = Buffer.concat(stderrChunks).toString('utf-8');
			if (code === 0) {
				resolve(stdout);
				return;
			}
			reject(new Error(stderr.trim() || stdout.trim() || `Cron runner exited with code ${code ?? 'unknown'}.`));
		});
	});
};

export const runCronJob = (app: App, job: CronJobConfig): Promise<string> =>
	runCronRunnerCommand(app, ['run', '--config-path', job.configPath]);

export const enableCronJob = (app: App, job: CronJobConfig): Promise<string> =>
	runCronRunnerCommand(app, ['enable', '--job-id', job.id, '--config-path', job.configPath]);

export const disableCronJob = (app: App, job: CronJobConfig): Promise<string> =>
	runCronRunnerCommand(app, ['disable', '--job-id', job.id]);

export const getCronJobStatus = async (app: App, job: CronJobConfig): Promise<CronRunnerStatus> => {
	const stdout = await runCronRunnerCommand(app, ['status', '--job-id', job.id]);
	return {
		enabled: stdout.includes('status: enabled'),
		stdout,
	};
};

export const jobToReportSource = (job: CronJobConfig): ReportSource => ({
	id: job.id,
	label: job.title,
	folder: job.outputFolder,
	pattern: new RegExp(`^${escapeRegExp(job.filePrefix)}_(\\d{4}-\\d{2}-\\d{2})\\.(md|html)$`),
	frequency: job.frequency === CRON_FREQUENCY.WEEKLY ? 'weekly' : 'daily',
});

export const formatCronSchedule = (job: CronJobConfig): string => {
	if (job.frequency === CRON_FREQUENCY.MANUAL) return 'Manual';
	if (job.frequency === CRON_FREQUENCY.WEEKLY) return `${WEEKDAY_LABELS[job.weekday]}s ${formatDisplayTime(job.time)}`;
	return `Daily ${formatDisplayTime(job.time)}`;
};

export const createCronConfigNote = (job: CronJobConfig, settings: PluginSettings): string => `---
cron_id: ${yamlQuote(job.id)}
title: ${yamlQuote(job.title)}
description: ${yamlQuote(job.description)}
frequency: ${yamlQuote(job.frequency)}
time: ${yamlQuote(job.time)}
weekday: ${yamlQuote(job.weekday)}
output_folder: ${yamlQuote(job.outputFolder)}
file_prefix: ${yamlQuote(job.filePrefix)}
working_directory: ${yamlQuote(job.workingDirectory)}
ai_tool: ${yamlQuote(settings.aiTool)}
ai_tool_path: ${yamlQuote(settings.aiToolPath)}
ai_skip_permissions: ${settings.aiSkipPermissions ? 'true' : 'false'}
enabled: ${job.enabled ? 'true' : 'false'}
---

# ${job.title}

${job.description}

## Prompt

${job.prompt}
`;

export const createCronJobFromInput = (
	title: string,
	description: string,
	prompt: string,
	frequency: CronJobConfig['frequency'],
	time: string,
	weekday: CronWeekday,
	outputFolder: string,
	workingDirectory: string,
): CronJobConfig => {
	const now = Date.now();
	const id = slugify(title);
	const filePrefix = filePrefixFromTitle(title);
	return {
		id,
		title: title.trim(),
		description: description.trim(),
		prompt: prompt.trim(),
		frequency,
		time,
		weekday,
		outputFolder: outputFolder.trim() || `${DEFAULT_CRON_BASE_PATH}/${title.trim()}`,
		filePrefix,
		configPath: `${DEFAULT_CRON_BASE_PATH}/Configs/${filePrefix}.md`,
		workingDirectory: workingDirectory.trim(),
		enabled: frequency !== CRON_FREQUENCY.MANUAL,
		createdAt: now,
		updatedAt: now,
	};
};

export const updateCronJobFromInput = (
	existing: CronJobConfig,
	title: string,
	description: string,
	prompt: string,
	frequency: CronJobConfig['frequency'],
	time: string,
	weekday: CronWeekday,
	outputFolder: string,
	workingDirectory: string,
): CronJobConfig => ({
	...existing,
	title: title.trim(),
	description: description.trim(),
	prompt: prompt.trim(),
	frequency,
	time,
	weekday,
	outputFolder: outputFolder.trim(),
	workingDirectory: workingDirectory.trim(),
	enabled: frequency === CRON_FREQUENCY.MANUAL ? false : existing.enabled,
	updatedAt: Date.now(),
});

const slugify = (value: string): string =>
	value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || `cron-${Date.now()}`;

const filePrefixFromTitle = (value: string): string =>
	value.trim().replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'Report';

const formatDisplayTime = (value: string): string => {
	const [hourText, minuteText] = value.split(':');
	const hour = Number(hourText);
	const minute = Number(minuteText);
	if (Number.isNaN(hour) || Number.isNaN(minute)) return value;
	const suffix = hour >= 12 ? 'PM' : 'AM';
	const displayHour = hour % 12 === 0 ? 12 : hour % 12;
	return `${displayHour}:${String(minute).padStart(2, '0')} ${suffix}`;
};

const escapeRegExp = (value: string): string =>
	value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const yamlQuote = (value: string): string =>
	`"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
