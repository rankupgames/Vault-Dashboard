/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard Welcome
 * Description: Last opened and quick access document modules using composition
 * Created: 2026-03-07
 * Last Modified: 2026-03-07
 */

import { App, FuzzySuggestModal, TFile, setIcon } from 'obsidian';
import { ConfirmModal } from '../modals/ConfirmModal';
import { ModuleConfig } from '../core/types';
import { ModuleRenderer } from './ModuleCard';
import { DocumentTracker } from '../services/DocumentTracker';

const setDocIcon = (el: HTMLElement): void => { setIcon(el, 'file-text'); };

class FileSuggestModal extends FuzzySuggestModal<TFile> {
	private onSelect: (file: TFile) => void;

	constructor(app: App, onSelect: (file: TFile) => void) {
		super(app);
		this.onSelect = onSelect;
		this.setPlaceholder('Search for a file to add...');
	}

	getItems(): TFile[] {
		return this.app.vault.getFiles();
	}

	getItemText(file: TFile): string {
		return file.path;
	}

	onChooseItem(file: TFile): void {
		this.onSelect(file);
	}
}

/** Module that displays recently opened documents. */
export class LastOpenedModule implements ModuleRenderer {
	readonly id = 'last-opened';
	readonly name = 'Last Opened Documents';

	private app: App;
	private tracker: DocumentTracker;

	constructor(app: App, _config: ModuleConfig) {
		this.app = app;
		this.tracker = new DocumentTracker(app);
	}

	/** Renders the last-opened document list into the given element. */
	renderContent(el: HTMLElement): void {
		const docs = this.tracker.getLastOpened(12);
		if (docs.length === 0) {
			el.createDiv({ cls: 'vw-module-empty', text: 'No recent documents' });
			return;
		}

		const list = el.createDiv({ cls: 'vw-doc-list' });
		for (const doc of docs) {
			const row = list.createDiv({ cls: 'vw-doc-row' });
			if (doc.exists === false) {
				row.addClass('vw-doc-missing');
			}
			row.createSpan({ cls: 'vw-doc-link', text: doc.name });
			const icon = row.createDiv({ cls: 'vw-doc-open-icon' });
			setDocIcon(icon);
			row.addEventListener('click', () => this.tracker.openFile(doc.path));
		}
	}
}

/** Module that displays pinned quick-access documents with add/remove controls. */
export class QuickAccessModule implements ModuleRenderer {
	readonly id = 'quick-access';
	readonly name = 'Quick Access Documents';

	private app: App;
	private tracker: DocumentTracker;
	private paths: string[];
	private onPathsChange: ((paths: string[]) => void) | null = null;
	private bodyEl: HTMLElement | null = null;

	constructor(app: App, _config: ModuleConfig, paths: string[]) {
		this.app = app;
		this.tracker = new DocumentTracker(app);
		this.paths = paths;
	}

	/** Registers a callback invoked when pinned paths change. */
	onPathsChanged(cb: (paths: string[]) => void): void {
		this.onPathsChange = cb;
	}

	/** Adds a file path to the quick-access list. */
	addPath(path: string): void {
		if (this.paths.includes(path)) return;
		this.paths.push(path);
		if (this.onPathsChange) this.onPathsChange(this.paths);
		this.refreshBody();
	}

	/** Renders the add-file button in the header. */
	renderHeaderActions(actionsEl: HTMLElement): void {
		const addBtn = actionsEl.createDiv({ cls: 'vw-module-refresh' });
		setIcon(addBtn, 'plus');
		addBtn.setAttribute('aria-label', 'Add file');
		addBtn.setAttribute('tabindex', '0');
		addBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			new FileSuggestModal(this.app, (file) => {
				this.addPath(file.path);
			}).open();
		});
	}

	/** Renders the quick-access document list into the given element. */
	renderContent(el: HTMLElement): void {
		this.bodyEl = el;

		if (this.paths.length === 0) {
			el.createDiv({
				cls: 'vw-module-empty',
				text: 'No pinned documents yet. Click + or right-click files to add.',
			});
			return;
		}

		const docs = this.tracker.getQuickAccess(this.paths);
		const list = el.createDiv({ cls: 'vw-doc-list' });

		for (const doc of docs) {
			const row = list.createDiv({ cls: 'vw-doc-row' });
			if (doc.exists === false) {
				row.addClass('vw-doc-missing');
			}

			row.createSpan({ cls: 'vw-doc-link', text: doc.name });
			const icon = row.createDiv({ cls: 'vw-doc-open-icon' });
			setDocIcon(icon);
			row.addEventListener('click', () => this.tracker.openFile(doc.path));

			const removeBtn = row.createSpan({ cls: 'vw-doc-remove' });
			setIcon(removeBtn, 'x');
			removeBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				new ConfirmModal(this.app, 'Remove Document', `Remove "${doc.name}" from quick access?`, () => {
					this.paths = this.paths.filter((p) => p !== doc.path);
					if (this.onPathsChange) this.onPathsChange(this.paths);
					this.refreshBody();
				}).open();
			});
		}
	}

	/** Clears and re-renders the module body content. */
	private refreshBody(): void {
		if (this.bodyEl === null) return;
		this.bodyEl.empty();
		this.renderContent(this.bodyEl);
	}
}
