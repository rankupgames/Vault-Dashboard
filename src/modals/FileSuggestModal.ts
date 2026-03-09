/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard Welcome
 * Description: Fuzzy file picker modal for linking vault documents to tasks
 * Created: 2026-03-08
 * Last Modified: 2026-03-08
 */

import { App, FuzzySuggestModal, TFile } from 'obsidian';

export class FileSuggestModal extends FuzzySuggestModal<TFile> {
	private onChoose: (file: TFile) => void;
	private extensions: string[] | null;

	constructor(app: App, onChoose: (file: TFile) => void, extensions: string[] | null = null) {
		super(app);
		this.onChoose = onChoose;
		this.extensions = extensions;
		this.setPlaceholder(extensions ? 'Search for a file...' : 'Search for a document to link...');
	}

	getItems(): TFile[] {
		if (this.extensions) {
			return this.app.vault.getFiles()
				.filter((f) => this.extensions!.includes(f.extension.toLowerCase()))
				.sort((a, b) => b.stat.mtime - a.stat.mtime);
		}
		return this.app.vault.getMarkdownFiles().sort((a, b) => b.stat.mtime - a.stat.mtime);
	}

	getItemText(file: TFile): string {
		return file.path;
	}

	onChooseItem(file: TFile): void {
		this.onChoose(file);
	}
}
