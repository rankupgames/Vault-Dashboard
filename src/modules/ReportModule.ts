/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard Welcome
 * Description: Daily and weekly report modules driven by user-configurable report source settings
 * Created: 2026-03-07
 * Last Modified: 2026-03-09
 */

import { App, setIcon } from 'obsidian';
import { ModuleConfig, ReportSource, ReportSourceConfig } from '../core/types';
import { ModuleRenderer } from './ModuleCard';
import { ReportScanner, ReportEntry } from '../services/ReportScanner';

function configToSource(cfg: ReportSourceConfig, basePath: string): ReportSource {
	return {
		id: cfg.id,
		label: cfg.label,
		folder: `${basePath}/${cfg.folder}`,
		pattern: new RegExp(cfg.patternStr),
		frequency: cfg.frequency,
	};
}

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
