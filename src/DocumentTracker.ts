/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard Welcome
 * Description: Tracks recently opened files and quick access pinned documents
 * Created: 2026-03-07
 * Last Modified: 2026-03-07
 */

import { App, TFile } from 'obsidian';

export interface DocumentEntry {
	path: string;
	name: string;
	exists: boolean;
}

export class DocumentTracker {
	private app: App;

	constructor(app: App) {
		this.app = app;
	}

	getLastOpened(limit: number = 15): DocumentEntry[] {
		const recentFiles: string[] = (this.app.workspace as Record<string, unknown>)['recentFiles'] as string[] ?? [];

		if (recentFiles.length === 0) {
			return this.fallbackLastOpened(limit);
		}

		return recentFiles
			.filter((p) => this.isAllowedFile(p))
			.slice(0, limit)
			.map((path) => this.toEntry(path));
	}

	getQuickAccess(paths: string[]): DocumentEntry[] {
		return paths.map((p) => this.toEntry(p));
	}

	openFile(path: string): void {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) {
			const leaf = this.app.workspace.getLeaf('tab');
			leaf.openFile(file);
		}
	}

	fileExists(path: string): boolean {
		return this.app.vault.getAbstractFileByPath(path) instanceof TFile;
	}

	private isAllowedFile(path: string): boolean {
		return path.endsWith('.md') || path.endsWith('.canvas') || path.endsWith('.excalidraw');
	}

	private fallbackLastOpened(limit: number): DocumentEntry[] {
		const files = this.app.vault.getFiles();
		return files
			.filter((f) => this.isAllowedFile(f.path))
			.sort((a, b) => b.stat.mtime - a.stat.mtime)
			.slice(0, limit)
			.map((f) => ({
				path: f.path,
				name: f.basename,
				exists: true,
			}));
	}

	private toEntry(path: string): DocumentEntry {
		const file = this.app.vault.getAbstractFileByPath(path);
		const name = path.split('/').pop()?.replace(/\.\w+$/, '') ?? path;
		return {
			path,
			name,
			exists: file instanceof TFile,
		};
	}
}
