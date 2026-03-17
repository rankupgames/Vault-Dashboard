/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard
 * Description: Fuzzy file picker modal for linking vault documents to tasks
 * Created: 2026-03-08
 * Last Modified: 2026-03-08
 */

import { App, FuzzySuggestModal, TFile } from 'obsidian';
import { registerModal, unregisterModal } from '../core/modal-tracker';

/** Fuzzy file picker modal for linking vault documents or selecting files by extension. */
export class FileSuggestModal extends FuzzySuggestModal<TFile> {
	private onChoose: (file: TFile) => void;
	private extensions: string[] | null;

	/**
	 * @param app - Obsidian app instance
	 * @param onChoose - Callback invoked with the selected file
	 * @param extensions - Optional filter (e.g. ['png','jpg']) or null for markdown only
	 */
	constructor(app: App, onChoose: (file: TFile) => void, extensions: string[] | null = null) {
		super(app);
		this.onChoose = onChoose;
		this.extensions = extensions;
		this.setPlaceholder(extensions ? 'Search for a file...' : 'Search for a document to link...');
	}

	/** @override */
	onOpen(): void {
		super.onOpen();
		registerModal(this);
	}

	/** @override */
	onClose(): void {
		unregisterModal(this);
		super.onClose();
	}

	/** @override */
	getItems(): TFile[] {
		if (this.extensions) {
			return this.app.vault.getFiles()
				.filter((f) => this.extensions!.includes(f.extension.toLowerCase()))
				.sort((a, b) => b.stat.mtime - a.stat.mtime);
		}
		return this.app.vault.getMarkdownFiles().sort((a, b) => b.stat.mtime - a.stat.mtime);
	}

	/** @override */
	getItemText(file: TFile): string {
		return file.path;
	}

	/** @override */
	onChooseItem(file: TFile): void {
		this.onChoose(file);
	}
}
