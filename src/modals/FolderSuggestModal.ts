/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard Welcome
 * Description: Fuzzy folder picker modal for selecting vault directories
 * Created: 2026-03-10
 * Last Modified: 2026-03-10
 */

import { App, FuzzySuggestModal, TFolder, TAbstractFile } from 'obsidian';

/** Fuzzy folder picker modal for selecting vault directories. */
export class FolderSuggestModal extends FuzzySuggestModal<TFolder> {
	private onChoose: (folder: TFolder) => void;

	/**
	 * @param app - Obsidian app instance
	 * @param onChoose - Callback invoked with the selected folder
	 */
	constructor(app: App, onChoose: (folder: TFolder) => void) {
		super(app);
		this.onChoose = onChoose;
		this.setPlaceholder('Search for a folder...');
	}

	/** @override */
	getItems(): TFolder[] {
		const folders: TFolder[] = [];
		const visit = (item: TAbstractFile): void => {
			if (item instanceof TFolder) {
				folders.push(item);
				for (const child of item.children) visit(child);
			}
		};
		visit(this.app.vault.getRoot());
		return folders.sort((a, b) => a.path.localeCompare(b.path));
	}

	/** @override */
	getItemText(folder: TFolder): string {
		return folder.path || '/';
	}

	/** @override */
	onChooseItem(folder: TFolder): void {
		this.onChoose(folder);
	}
}
