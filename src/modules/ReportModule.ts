/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vaultboard
 * Description: Daily and weekly report modules driven by user-configurable report source settings
 * Created: 2026-03-07
 * Last Modified: 2026-05-13
 */

import { App, Notice, TFile, setIcon } from 'obsidian';
import { GmailDigestSettings, ModuleConfig, ReportSource, ReportSourceConfig } from '../core/types';
import { ModuleRenderer } from './ModuleCard';
import { ReportScanner, ReportEntry } from '../services/ReportScanner';
import type { PromptDispatchProvider } from './PromptDispatchProvider';
import {
	createGmailReviewPrompt,
	GMAIL_DIGEST_SOURCE,
	GMAIL_SETUP_PATH,
	resolveGmailDigestCommandPaths,
	runGmailLaunchdCommand,
	runGmailOAuthSetup,
} from '../services/GmailDigestRunner';

function configToSource(cfg: ReportSourceConfig, basePath: string): ReportSource {
	return {
		id: cfg.id,
		label: cfg.label,
		folder: `${basePath}/${cfg.folder}`,
		pattern: new RegExp(cfg.patternStr),
		frequency: cfg.frequency,
	};
}

const REPORT_LIST_LIMIT = 5;

const renderReportRow = (list: HTMLElement, report: ReportEntry, scanner: ReportScanner): void => {
	const rowCls = report.isNew ? 'vw-report-row vw-report-new' : 'vw-report-row';
	const row = list.createDiv({ cls: rowCls });

	if (report.isNew) {
		row.createSpan({ cls: 'vw-report-new-badge', text: 'new' });
	}

	row.createSpan({ cls: 'vw-report-title', text: report.title });

	const icon = row.createDiv({ cls: 'vw-report-open-icon' });
	setIcon(icon, 'file-text');

	row.addEventListener('click', () => {
		scanner.openReport(report.file);
		row.removeClass('vw-report-new');
		row.querySelector('.vw-report-new-badge')?.remove();
	});
};

let gmailOAuthSetupRunning = false;
let gmailLaunchdStatus: boolean | null = null;
let gmailLaunchdStatusLoading = false;
let gmailLaunchdToggleRunning = false;

const renderSection = (el: HTMLElement, source: ReportSource, scanner: ReportScanner): void => {
	const reports = scanner.getReports(source);

	const section = el.createDiv({ cls: 'vw-report-section' });
	const header = section.createDiv({ cls: 'vw-report-section-header' });
	const newCount = reports.filter((r) => r.isNew).length;
	header.createSpan({ text: source.label });
	if (newCount > 0) {
		header.createSpan({ cls: 'vw-report-section-badge', text: String(newCount) });
	}

	if (reports.length === 0) {
		section.createDiv({ cls: 'vw-module-empty', text: 'No reports found' });
		return;
	}

	const list = section.createDiv({ cls: 'vw-report-list' });
	for (const report of reports.slice(0, REPORT_LIST_LIMIT)) {
		renderReportRow(list, report, scanner);
	}
};

/** Module that displays daily reports from configured report sources. */
export class DailyReportModule implements ModuleRenderer {
	readonly id = 'daily-reports';
	readonly name = 'Daily Reports';
	readonly showRefresh = true;

	private scanner: ReportScanner;
	private sources: ReportSource[];

	constructor(_app: App, _config: ModuleConfig, scanner: ReportScanner, reportBasePath: string, reportConfigs: ReportSourceConfig[]) {
		this.scanner = scanner;
		this.sources = reportConfigs
			.filter((c) => c.frequency === 'daily' && c.enabled)
			.map((c) => configToSource(c, reportBasePath));
	}

	/** Renders daily report sections into the given element. */
	renderContent(el: HTMLElement): void {
		let totalReports = 0;
		for (const source of this.sources) {
			totalReports += this.scanner.getReports(source).length;
		}

		if (totalReports === 0) {
			el.createDiv({ cls: 'vw-module-empty', text: 'No daily reports found' });
			return;
		}

		for (const source of this.sources) {
			renderSection(el, source, this.scanner);
		}
	}
}

/** Module that displays weekly reports from configured report sources. */
export class WeeklyReportModule implements ModuleRenderer {
	readonly id = 'weekly-reports';
	readonly name = 'Weekly Reports';
	readonly showRefresh = true;

	private scanner: ReportScanner;
	private sources: ReportSource[];

	constructor(_app: App, _config: ModuleConfig, scanner: ReportScanner, reportBasePath: string, reportConfigs: ReportSourceConfig[]) {
		this.scanner = scanner;
		this.sources = reportConfigs
			.filter((c) => c.frequency === 'weekly' && c.enabled)
			.map((c) => configToSource(c, reportBasePath));
	}

	/** Renders weekly report sections into the given element. */
	renderContent(el: HTMLElement): void {
		let totalReports = 0;
		for (const source of this.sources) {
			totalReports += this.scanner.getReports(source).length;
		}

		if (totalReports === 0) {
			el.createDiv({ cls: 'vw-module-empty', text: 'No weekly reports yet' });
			return;
		}

		for (const source of this.sources) {
			renderSection(el, source, this.scanner);
		}
	}
}

/** Module that displays Gmail analysis digests without exposing raw mail or OAuth data. */
export class GmailIntelligenceModule implements ModuleRenderer {
	readonly id = 'gmail-intelligence';
	readonly name = 'Gmail Intelligence';
	readonly showRefresh = true;

	private app: App;
	private scanner: ReportScanner;
	private gmailSettings: GmailDigestSettings;
	private dispatchProvider?: PromptDispatchProvider;

	constructor(
		app: App,
		_config: ModuleConfig,
		scanner: ReportScanner,
		gmailSettings: GmailDigestSettings,
		dispatchProvider?: PromptDispatchProvider,
	) {
		this.app = app;
		this.scanner = scanner;
		this.gmailSettings = gmailSettings;
		this.dispatchProvider = dispatchProvider;
	}

	/** Renders setup access and latest Gmail analysis digest notes. */
	renderContent(el: HTMLElement): void {
		this.renderSetupSection(el);
		this.renderAutomationSection(el);
		this.renderDigestSection(el);
	}

	private renderSetupSection(el: HTMLElement): void {
		const section = el.createDiv({ cls: 'vw-report-section' });
		const header = section.createDiv({ cls: 'vw-report-section-header' });
		header.createSpan({ text: 'Setup' });

		const list = section.createDiv({ cls: 'vw-report-list' });
		const row = list.createDiv({ cls: 'vw-report-row' });
		row.createSpan({ cls: 'vw-report-title', text: 'Gmail Intelligence setup and workflow' });

		const actions = row.createDiv({ cls: 'vw-report-actions' });
		const authButton = actions.createDiv({ cls: 'vw-report-action-btn' });
		setIcon(authButton, gmailOAuthSetupRunning ? 'loader' : 'key-round');
		authButton.setAttribute('aria-label', 'Run Gmail OAuth setup');
		authButton.setAttribute('tabindex', '0');
		if (gmailOAuthSetupRunning) {
			authButton.addClass('is-disabled');
		}
		authButton.addEventListener('click', (event) => {
			event.stopPropagation();
			this.handleOAuthSetup(authButton);
		});
		authButton.addEventListener('keydown', (event: KeyboardEvent) => {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			event.preventDefault();
			event.stopPropagation();
			this.handleOAuthSetup(authButton);
		});

		const icon = actions.createDiv({ cls: 'vw-report-open-icon' });
		setIcon(icon, 'settings');

		row.addEventListener('click', () => {
			const setupFile = this.app.vault.getAbstractFileByPath(GMAIL_SETUP_PATH);
			if (setupFile instanceof TFile === false) {
				new Notice('Gmail Intelligence setup note not found');
				return;
			}

			const leaf = this.app.workspace.getLeaf('tab');
			leaf.openFile(setupFile);
		});
	}

	private renderAutomationSection(el: HTMLElement): void {
		const section = el.createDiv({ cls: 'vw-report-section' });
		const header = section.createDiv({ cls: 'vw-report-section-header' });
		header.createSpan({ text: 'Automation' });

		const list = section.createDiv({ cls: 'vw-report-list' });

		const toggleRow = list.createDiv({ cls: 'vw-report-row' });
		const toggleInfo = toggleRow.createDiv({ cls: 'vw-report-info' });
		toggleInfo.createSpan({ cls: 'vw-report-title', text: '8 AM Gmail digest' });
		const status = toggleInfo.createSpan({
			cls: 'vw-report-meta',
			text: this.formatGmailLaunchdStatus(),
		});
		const toggleActions = toggleRow.createDiv({ cls: 'vw-report-actions' });
		const toggle = toggleActions.createDiv({ cls: 'vw-report-toggle' });
		toggle.createDiv({ cls: 'vw-report-toggle-knob' });
		toggle.setAttribute('tabindex', '0');
		this.updateLaunchdToggle(toggle);
		toggle.addEventListener('click', (event) => {
			event.stopPropagation();
			this.handleLaunchdToggle(status, toggle);
		});
		toggle.addEventListener('keydown', (event: KeyboardEvent) => {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			event.preventDefault();
			event.stopPropagation();
			this.handleLaunchdToggle(status, toggle);
		});

		const dispatchRow = list.createDiv({ cls: 'vw-report-row' });
		const dispatchInfo = dispatchRow.createDiv({ cls: 'vw-report-info' });
		dispatchInfo.createSpan({ cls: 'vw-report-title', text: 'Manual email review' });
		dispatchInfo.createSpan({ cls: 'vw-report-meta', text: 'Send read-only Gmail review prompt to AI Dispatches' });
		const dispatchActions = dispatchRow.createDiv({ cls: 'vw-report-actions' });
		const dispatchButton = dispatchActions.createDiv({ cls: 'vw-report-action-btn' });
		setIcon(dispatchButton, 'send');
		dispatchButton.setAttribute('aria-label', 'Dispatch manual Gmail review');
		dispatchButton.setAttribute('tabindex', '0');
		dispatchButton.addEventListener('click', (event) => {
			event.stopPropagation();
			this.handleManualGmailReview();
		});
		dispatchButton.addEventListener('keydown', (event: KeyboardEvent) => {
			if (event.key !== 'Enter' && event.key !== ' ') return;
			event.preventDefault();
			event.stopPropagation();
			this.handleManualGmailReview();
		});
		dispatchRow.addEventListener('click', () => this.handleManualGmailReview());

		if (gmailLaunchdStatus === null && gmailLaunchdStatusLoading === false) {
			this.refreshLaunchdStatus(status, toggle);
		}
	}

	private formatGmailLaunchdStatus(): string {
		if (gmailLaunchdToggleRunning) return 'Updating launchd...';
		if (gmailLaunchdStatusLoading) return 'Checking launchd status...';
		if (gmailLaunchdStatus === null) return 'Status unknown';
		return gmailLaunchdStatus ? 'Enabled · daily 8 AM' : 'Disabled';
	}

	private updateLaunchdToggle(toggle: HTMLElement): void {
		toggle.toggleClass('is-enabled', gmailLaunchdStatus === true);
		toggle.toggleClass('is-disabled', gmailLaunchdToggleRunning || gmailLaunchdStatusLoading);
		toggle.setAttribute('role', 'switch');
		toggle.setAttribute('aria-checked', gmailLaunchdStatus === true ? 'true' : 'false');
		toggle.setAttribute('aria-label', gmailLaunchdStatus === true ? 'Disable 8 AM Gmail digest' : 'Enable 8 AM Gmail digest');
	}

	private refreshLaunchdStatus(status: HTMLElement, toggle: HTMLElement): void {
		gmailLaunchdStatusLoading = true;
		status.setText(this.formatGmailLaunchdStatus());
		this.updateLaunchdToggle(toggle);

		runGmailLaunchdCommand(this.app, this.gmailSettings, 'launchd-status')
			.then((stdout) => {
				gmailLaunchdStatus = stdout.includes('status: enabled');
			})
			.catch((error: Error) => {
				console.error('[GmailIntelligence] launchd status failed:', error);
				gmailLaunchdStatus = false;
			})
			.finally(() => {
				gmailLaunchdStatusLoading = false;
				if (status.isConnected && toggle.isConnected) {
					status.setText(this.formatGmailLaunchdStatus());
					this.updateLaunchdToggle(toggle);
				}
			});
	}

	private handleLaunchdToggle(status: HTMLElement, toggle: HTMLElement): void {
		if (gmailLaunchdToggleRunning || gmailLaunchdStatusLoading) return;

		const command = gmailLaunchdStatus === true ? 'disable-launchd' : 'enable-launchd';
		gmailLaunchdToggleRunning = true;
		status.setText(this.formatGmailLaunchdStatus());
		this.updateLaunchdToggle(toggle);

		runGmailLaunchdCommand(this.app, this.gmailSettings, command)
			.then(() => {
				gmailLaunchdStatus = command === 'enable-launchd';
				new Notice(gmailLaunchdStatus ? '8 AM Gmail digest enabled' : '8 AM Gmail digest disabled');
			})
			.catch((error: Error) => {
				new Notice('Gmail launchd update failed');
				console.error('[GmailIntelligence] launchd toggle failed:', error);
			})
			.finally(() => {
				gmailLaunchdToggleRunning = false;
				if (status.isConnected && toggle.isConnected) {
					status.setText(this.formatGmailLaunchdStatus());
					this.updateLaunchdToggle(toggle);
				}
			});
	}

	private handleManualGmailReview(): void {
		if (this.dispatchProvider === undefined) {
			new Notice('No AI dispatcher configured');
			return;
		}

		const paths = resolveGmailDigestCommandPaths(this.app, this.gmailSettings);
		void this.dispatchProvider
			.dispatchPrompt('Review Gmail Intelligence', createGmailReviewPrompt(paths, this.gmailSettings), paths.workingDirectory)
			.then((recordId) => {
				if (recordId) new Notice('Gmail review dispatched');
			})
			.catch((error: Error) => {
				new Notice('Gmail review dispatch failed');
				console.error('[GmailIntelligence] manual review failed:', error);
			});
	}

	private handleOAuthSetup(button: HTMLElement): void {
		if (gmailOAuthSetupRunning) {
			new Notice('Gmail OAuth setup is already running');
			return;
		}

		button.addClass('is-disabled');
		setIcon(button, 'loader');
		new Notice('Opening Gmail OAuth consent in your browser...');

		gmailOAuthSetupRunning = true;

		runGmailOAuthSetup(this.app, this.gmailSettings)
			.then(() => {
				new Notice('Gmail OAuth setup complete');
			})
			.catch((error: Error) => {
				new Notice(error.message.includes('desktop') ? error.message : 'Gmail OAuth setup failed');
				console.error('[GmailIntelligence] OAuth setup failed:', error);
			})
			.finally(() => {
				gmailOAuthSetupRunning = false;
				if (button.isConnected) {
					button.removeClass('is-disabled');
					setIcon(button, 'key-round');
				}
			});
	}

	private renderDigestSection(el: HTMLElement): void {
		const reports = this.scanner.getReports(GMAIL_DIGEST_SOURCE);
		const section = el.createDiv({ cls: 'vw-report-section' });
		const header = section.createDiv({ cls: 'vw-report-section-header' });
		const newCount = reports.filter((r) => r.isNew).length;
		header.createSpan({ text: GMAIL_DIGEST_SOURCE.label });
		if (newCount > 0) {
			header.createSpan({ cls: 'vw-report-section-badge', text: String(newCount) });
		}

		if (reports.length === 0) {
			section.createDiv({ cls: 'vw-module-empty', text: 'No Gmail analysis digests yet' });
			return;
		}

		const list = section.createDiv({ cls: 'vw-report-list' });
		for (const report of reports.slice(0, REPORT_LIST_LIMIT)) {
			renderReportRow(list, report, this.scanner);
		}
	}
}
