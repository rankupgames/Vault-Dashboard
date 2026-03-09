/*
 * Author: Miguel A. Lopez
 * Edited By: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard Welcome
 * Description: Daily and weekly report modules with sectioned grouped output and new-report indicators
 * Created: 2026-03-07
 * Last Modified: 2026-03-08
 */

import { App } from 'obsidian';
import { ModuleConfig, ReportSource } from '../types';
import { ModuleRenderer } from '../components/ModuleCard';
import { ReportScanner, ReportEntry } from '../ReportScanner';

const buildReportSources = (basePath: string): ReportSource[] => [
	{
		id: 'interview-prep',
		label: 'Interview Prep',
		folder: `${basePath}/Daily Interview Prep`,
		pattern: /^(.+)\.(md|html)$/,
		frequency: 'daily',
	},
	{
		id: 'daily-trends',
		label: 'Daily Trends',
		folder: `${basePath}/Review Daily Trends`,
		pattern: /^Daily_Trends_Report_(\d{4}-\d{2}-\d{2})\.(md|html)$/,
		frequency: 'daily',
	},
	{
		id: 'local-leads',
		label: 'Local Leads',
		folder: `${basePath}/Daily Local Leads`,
		pattern: /^(.+)\.(md|html)$/,
		frequency: 'daily',
	},
	{
		id: 'app-store-intel',
		label: 'App Store Intel',
		folder: `${basePath}/Daily App Store Intel`,
		pattern: /^(.+)\.(md|html)$/,
		frequency: 'daily',
	},
	{
		id: 'weekly-jobs',
		label: 'Jobs Report',
		folder: `${basePath}/Weekly Jobs Reports`,
		pattern: /^(.+)\.(md|html)$/,
		frequency: 'weekly',
	},
	{
		id: 'competitor-watch',
		label: 'Competitor Watch',
		folder: `${basePath}/Weekly Competitor Watch`,
		pattern: /^(.+)\.(md|html)$/,
		frequency: 'weekly',
	},
];

const renderReportRow = (list: HTMLElement, report: ReportEntry, scanner: ReportScanner): void => {
	const rowCls = report.isNew ? 'vw-report-row vw-report-new' : 'vw-report-row';
	const row = list.createDiv({ cls: rowCls });

	if (report.isNew) {
		row.createSpan({ cls: 'vw-report-new-badge', text: 'new' });
	}

	row.createSpan({ cls: 'vw-report-title', text: report.title });

	const icon = row.createDiv({ cls: 'vw-report-open-icon' });
	icon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>`;

	row.addEventListener('click', () => {
		scanner.openReport(report.file);
		row.removeClass('vw-report-new');
		row.querySelector('.vw-report-new-badge')?.remove();
	});
};

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
	for (const report of reports.slice(0, 10)) {
		renderReportRow(list, report, scanner);
	}
};

export class DailyReportModule implements ModuleRenderer {
	readonly id = 'daily-reports';
	readonly name = 'Daily Reports';
	readonly showRefresh = true;

	private scanner: ReportScanner;
	private sources: ReportSource[];

	constructor(_app: App, _config: ModuleConfig, scanner: ReportScanner, reportBasePath: string) {
		this.scanner = scanner;
		this.sources = buildReportSources(reportBasePath).filter((s) => s.frequency === 'daily');
	}

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

export class WeeklyReportModule implements ModuleRenderer {
	readonly id = 'weekly-reports';
	readonly name = 'Weekly Reports';
	readonly showRefresh = true;

	private scanner: ReportScanner;
	private sources: ReportSource[];

	constructor(_app: App, _config: ModuleConfig, scanner: ReportScanner, reportBasePath: string) {
		this.scanner = scanner;
		this.sources = buildReportSources(reportBasePath).filter((s) => s.frequency === 'weekly');
	}

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
