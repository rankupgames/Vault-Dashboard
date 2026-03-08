/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard Welcome
 * Description: Last opened and quick access document modules using composition
 * Created: 2026-03-07
 * Last Modified: 2026-03-07
 */

import { App, FuzzySuggestModal, TFile, setIcon } from 'obsidian';
import { ModuleConfig } from '../types';
import { ModuleRenderer } from '../components/ModuleCard';
import { DocumentTracker } from '../DocumentTracker';

const DOC_OPEN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>`;

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

export class LastOpenedModule implements ModuleRenderer {
	readonly id = 'last-opened';
	readonly name = 'Last Opened Documents';

	private app: App;
	private tracker: DocumentTracker;

	constructor(app: App, _config: ModuleConfig) {
		this.app = app;
		this.tracker = new DocumentTracker(app);
	}

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
			icon.innerHTML = DOC_OPEN_SVG;
			row.addEventListener('click', () => this.tracker.openFile(doc.path));
		}
	}
}

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

	onPathsChanged(cb: (paths: string[]) => void): void {
		this.onPathsChange = cb;
	}

	addPath(path: string): void {
		if (this.paths.includes(path)) return;
		this.paths.push(path);
		if (this.onPathsChange) this.onPathsChange(this.paths);
		this.refreshBody();
	}

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
			icon.innerHTML = DOC_OPEN_SVG;
			row.addEventListener('click', () => this.tracker.openFile(doc.path));

			const removeBtn = row.createSpan({ cls: 'vw-doc-remove' });
			setIcon(removeBtn, 'x');
			removeBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				this.paths = this.paths.filter((p) => p !== doc.path);
				if (this.onPathsChange) this.onPathsChange(this.paths);
				this.refreshBody();
			});
		}
	}

	private refreshBody(): void {
		if (this.bodyEl === null) return;
		this.bodyEl.empty();
		this.renderContent(this.bodyEl);
	}
}
