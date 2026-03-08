/*
 * Author: Miguel A. Lopez
 * Edited By: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard Welcome
 * Description: Scans vault folders for cron report files with new-report detection
 * Created: 2026-03-07
 * Last Modified: 2026-03-08
 */

import { App, TFile, TFolder } from 'obsidian';
import { ReportSource } from './types';

export interface ReportEntry {
	file: TFile;
	title: string;
	date: string;
	isNew: boolean;
}

export class ReportScanner {
	private app: App;
	private lastOpenedAt: number;
	private viewedPaths: Set<string> = new Set();

	constructor(app: App, lastOpenedAt = 0) {
		this.app = app;
		this.lastOpenedAt = lastOpenedAt;
	}

	setLastOpenedAt(timestamp: number): void {
		this.lastOpenedAt = timestamp;
	}

	getReports(source: ReportSource): ReportEntry[] {
		const folder = this.app.vault.getAbstractFileByPath(source.folder);
		if (folder === null || !(folder instanceof TFolder)) return [];

		const today = new Date();
		today.setHours(0, 0, 0, 0);
		const todayStart = today.getTime();

		const entries: ReportEntry[] = [];
		for (const child of folder.children) {
			if (child instanceof TFile === false) continue;
			const file = child as TFile;
			const match = file.name.match(source.pattern);
			if (match === null) continue;

			const createdAfterLastOpen = file.stat.ctime > this.lastOpenedAt;
			const createdToday = file.stat.ctime >= todayStart;
			const isNew = createdAfterLastOpen && createdToday && this.viewedPaths.has(file.path) === false;

			entries.push({
				file,
				title: file.basename,
				date: match[1] ?? file.basename,
				isNew,
			});
		}

		return entries.sort((a, b) => b.date.localeCompare(a.date));
	}

	markViewed(path: string): void {
		this.viewedPaths.add(path);
	}

	openReport(file: TFile): void {
		this.markViewed(file.path);
		const leaf = this.app.workspace.getLeaf('tab');
		leaf.openFile(file);
	}
}
