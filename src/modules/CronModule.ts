/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vaultboard
 * Description: Launchd-backed cron control module with Vault config notes
 * Created: 2026-05-12
 * Last Modified: 2026-05-13
 */

import { App, Notice, TFile, TFolder, normalizePath, setIcon } from 'obsidian';
import { CRON_FREQUENCY, CronJobConfig, PluginSettings } from '../core/types';
import { ReportEntry, ReportScanner } from '../services/ReportScanner';
import { ModuleRenderer } from './ModuleCard';
import {
	createCronConfigNote,
	createCronJobFromInput,
	disableCronJob,
	enableCronJob,
	formatCronSchedule,
	getCronJobStatus,
	jobToReportSource,
	runCronJob,
} from '../services/CronRunner';
import { ensureVaultFolder } from '../services/VaultUtils';
import { CronEditorModal, CronEditorResult } from '../modals/CronEditorModal';

/** Module that lists dashboard-managed cron jobs and controls launchd schedules. */
export class CronModule implements ModuleRenderer {
	readonly id = 'crons';
	readonly name = 'Crons';
	readonly showRefresh = true;

	private app: App;
	private scanner: ReportScanner;
	private settings: PluginSettings;
	private onSettingsChanged: () => void;
	private bodyEl: HTMLElement | null = null;
	private runningIds = new Set<string>();
	private togglingIds = new Set<string>();
	private statusById = new Map<string, boolean>();

	constructor(
		app: App,
		_config: unknown,
		scanner: ReportScanner,
		settings: PluginSettings,
		onSettingsChanged: () => void,
	) {
		this.app = app;
		this.scanner = scanner;
		this.settings = settings;
		this.onSettingsChanged = onSettingsChanged;
	}

	renderHeaderActions(actionsEl: HTMLElement): void {
		const addBtn = actionsEl.createDiv({ cls: 'vw-module-refresh' });
		setIcon(addBtn, 'plus');
		addBtn.setAttribute('aria-label', 'Add cron');
		addBtn.setAttribute('tabindex', '0');
		addBtn.addEventListener('click', (event) => {
			event.stopPropagation();
			this.openCreateModal();
		});

		const refreshBtn = actionsEl.createDiv({ cls: 'vw-module-refresh' });
		setIcon(refreshBtn, 'refresh-cw');
		refreshBtn.setAttribute('aria-label', 'Refresh cron status');
		refreshBtn.setAttribute('tabindex', '0');
		refreshBtn.addEventListener('click', (event) => {
			event.stopPropagation();
			this.refreshBody();
			this.refreshLaunchdStatuses();
		});
	}

	renderContent(el: HTMLElement): void {
		this.bodyEl = el;
		const jobs = this.settings.cronJobs;
		const enabledCount = jobs.filter((job) => job.enabled).length;

		const section = el.createDiv({ cls: 'vw-report-section' });
		const header = section.createDiv({ cls: 'vw-report-section-header' });
		header.createSpan({ text: 'Scheduled Jobs' });
		header.createSpan({ cls: 'vw-report-section-badge', text: `${enabledCount}/${jobs.length}` });

		if (jobs.length === 0) {
			section.createDiv({ cls: 'vw-module-empty', text: 'No crons configured' });
			return;
		}

		const list = section.createDiv({ cls: 'vw-report-list' });
		for (const job of jobs) {
			this.renderCronRow(list, job);
		}
	}

	private renderCronRow(list: HTMLElement, job: CronJobConfig): void {
		const source = jobToReportSource(job);
		const reports = this.scanner.getReports(source);
		const latest = reports[0];
		const isDisabled = job.enabled === false;
		const rowCls = [
			'vw-report-row',
			latest?.isNew ? 'vw-report-new' : '',
			isDisabled ? 'vw-report-disabled' : '',
		].filter(Boolean).join(' ');
		const row = list.createDiv({ cls: rowCls });

		const info = row.createDiv({ cls: 'vw-report-info' });
		info.createSpan({ cls: 'vw-report-title', text: job.title });
		info.createSpan({
			cls: 'vw-report-meta',
			text: `${this.formatJobStatus(job)} · ${latest?.title ?? 'No report yet'}`,
		});

		const actions = row.createDiv({ cls: 'vw-report-actions' });
		this.addAction(actions, 'play', `Run ${job.title}`, () => { void this.runJob(job); }, this.runningIds.has(job.id));
		this.addAction(actions, 'folder-open', `Reveal ${job.title} output`, () => this.revealOutput(job, latest));
		this.addAction(actions, 'file-text', `Open ${job.title} config`, () => { void this.openConfigNote(job); });
		this.addCronToggle(actions, job);

		row.addEventListener('click', () => this.openLatestReport(job, latest));
	}

	private addAction(actions: HTMLElement, iconName: string, label: string, handler: () => void, disabled = false): void {
		const button = actions.createDiv({ cls: 'vw-report-action-btn' });
		setIcon(button, iconName);
		button.setAttribute('aria-label', label);
		button.setAttribute('tabindex', '0');
		if (disabled) {
			button.addClass('is-disabled');
			button.setAttribute('aria-disabled', 'true');
		}
		button.addEventListener('click', (event) => {
			event.stopPropagation();
			if (disabled) return;
			handler();
		});
		button.addEventListener('keydown', (event: KeyboardEvent) => {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			event.preventDefault();
			event.stopPropagation();
			if (disabled) return;
			handler();
		});
	}

	private addCronToggle(actions: HTMLElement, job: CronJobConfig): void {
		const toggle = actions.createDiv({ cls: job.enabled ? 'vw-report-toggle is-enabled' : 'vw-report-toggle' });
		toggle.createDiv({ cls: 'vw-report-toggle-knob' });
		toggle.setAttribute('role', 'switch');
		toggle.setAttribute('aria-checked', job.enabled ? 'true' : 'false');
		toggle.setAttribute('aria-label', job.enabled ? `Disable ${job.title}` : `Enable ${job.title}`);
		toggle.setAttribute('tabindex', '0');
		if (this.togglingIds.has(job.id)) {
			toggle.addClass('is-disabled');
		}
		toggle.addEventListener('click', (event) => {
			event.stopPropagation();
			void this.toggleJob(job);
		});
		toggle.addEventListener('keydown', (event: KeyboardEvent) => {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			event.preventDefault();
			event.stopPropagation();
			void this.toggleJob(job);
		});
	}

	private formatJobStatus(job: CronJobConfig): string {
		if (job.frequency === CRON_FREQUENCY.MANUAL) return 'Manual';
		if (job.enabled === false) return 'Disabled';
		const loaded = this.statusById.get(job.id);
		if (loaded === false) return `${formatCronSchedule(job)} · launchd off`;
		return formatCronSchedule(job);
	}

	private openCreateModal(): void {
		new CronEditorModal(this.app, null, (result) => {
			void this.createJob(result);
		}).open();
	}

	private async createJob(result: CronEditorResult): Promise<void> {
		const job = createCronJobFromInput(
			result.title,
			result.description,
			result.prompt,
			result.frequency,
			result.time,
			result.weekday,
			result.outputFolder,
			result.workingDirectory,
		);
		if (this.settings.cronJobs.some((existing) => existing.id === job.id)) {
			new Notice(`Cron already exists: ${job.title}`);
			return;
		}

		this.settings.cronJobs.push(job);
		await this.writeConfigNote(job, true);
		this.onSettingsChanged();
		this.refreshBody();
		if (job.enabled) {
			try {
				await this.enableJob(job);
			} catch (error) {
				job.enabled = false;
				job.updatedAt = Date.now();
				this.statusById.set(job.id, false);
				this.onSettingsChanged();
				this.refreshBody();
				new Notice(`${job.title} saved, but launchd enable failed`);
				console.error('[CronModule] create enable failed:', error);
			}
		}
	}

	private async runJob(job: CronJobConfig): Promise<void> {
		if (this.runningIds.has(job.id)) return;
		this.runningIds.add(job.id);
		this.refreshBody();
		try {
			await this.writeConfigNote(job, false);
			new Notice(`Running ${job.title}...`);
			await runCronJob(this.app, job);
			new Notice(`${job.title} complete`);
		} catch (error) {
			new Notice(`${job.title} failed`);
			console.error('[CronModule] run failed:', error);
		} finally {
			this.runningIds.delete(job.id);
			this.refreshBody();
		}
	}

	private async toggleJob(job: CronJobConfig): Promise<void> {
		if (this.togglingIds.has(job.id)) return;
		if (job.frequency === CRON_FREQUENCY.MANUAL) {
			new Notice('Manual jobs do not install launchd schedules');
			return;
		}

		this.togglingIds.add(job.id);
		this.refreshBody();
		try {
			if (job.enabled) {
				await disableCronJob(this.app, job);
				job.enabled = false;
				this.statusById.set(job.id, false);
				new Notice(`${job.title} disabled`);
			} else {
				await this.enableJob(job);
			}
			job.updatedAt = Date.now();
			this.onSettingsChanged();
		} catch (error) {
			new Notice(`${job.title} launchd update failed`);
			console.error('[CronModule] toggle failed:', error);
		} finally {
			this.togglingIds.delete(job.id);
			this.refreshBody();
		}
	}

	private async enableJob(job: CronJobConfig): Promise<void> {
		await this.writeConfigNote(job, false);
		await enableCronJob(this.app, job);
		job.enabled = true;
		job.updatedAt = Date.now();
		this.statusById.set(job.id, true);
		this.onSettingsChanged();
		new Notice(`${job.title} enabled`);
	}

	private async openConfigNote(job: CronJobConfig): Promise<void> {
		await this.writeConfigNote(job, false);
		const file = this.app.vault.getAbstractFileByPath(job.configPath);
		if (file instanceof TFile === false) {
			new Notice(`Config note not found: ${job.configPath}`);
			return;
		}
		this.app.workspace.getLeaf('tab').openFile(file);
	}

	private openLatestReport(job: CronJobConfig, latest: ReportEntry | undefined): void {
		if (latest === undefined) {
			new Notice(`No ${job.title} report found in ${job.outputFolder}`);
			return;
		}
		this.scanner.openReport(latest.file);
	}

	private revealOutput(job: CronJobConfig, latest: ReportEntry | undefined): void {
		const target = latest?.file ?? this.app.vault.getAbstractFileByPath(job.outputFolder);
		if (target instanceof TFile === false && target instanceof TFolder === false) {
			new Notice(`Output folder not found: ${job.outputFolder}`);
			return;
		}

		const leaf = this.app.workspace.getLeavesOfType('file-explorer')[0];
		const view = leaf?.view as { revealInFolder?: (file: TFile | TFolder) => void } | undefined;
		if (view?.revealInFolder) {
			view.revealInFolder(target);
			return;
		}

		if (target instanceof TFile) {
			this.scanner.openReport(target);
		}
	}

	private async writeConfigNote(job: CronJobConfig, overwrite: boolean): Promise<void> {
		await ensureVaultFolder(this.app, job.outputFolder);
		const parent = normalizePath(job.configPath.split('/').slice(0, -1).join('/'));
		if (parent) await ensureVaultFolder(this.app, parent);

		const existing = this.app.vault.getAbstractFileByPath(job.configPath);
		if (existing instanceof TFile) {
			if (overwrite) {
				await this.app.vault.modify(existing, createCronConfigNote(job, this.settings));
			}
			return;
		}
		await this.app.vault.create(job.configPath, createCronConfigNote(job, this.settings));
	}

	private refreshLaunchdStatuses(): void {
		for (const job of this.settings.cronJobs) {
			if (job.frequency === CRON_FREQUENCY.MANUAL) continue;
			void getCronJobStatus(this.app, job)
				.then((status) => {
					this.statusById.set(job.id, status.enabled);
					this.refreshBody();
				})
				.catch((error: Error) => {
					console.error('[CronModule] status failed:', error);
				});
		}
	}

	private refreshBody(): void {
		if (this.bodyEl === null) return;
		this.bodyEl.empty();
		this.renderContent(this.bodyEl);
	}
}
