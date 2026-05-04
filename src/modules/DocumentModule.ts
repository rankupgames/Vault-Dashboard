/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard
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

/** Module that displays newly created markdown files with quick-access pinning. */
export class LatestMarkdownModule implements ModuleRenderer {
	readonly id = 'latest-markdown';
	readonly name = 'Latest Markdown Files';
	readonly showRefresh = true;

	private tracker: DocumentTracker;
	private quickAccessPaths: string[];
	private onPinPath: (path: string) => void;

	constructor(app: App, _config: ModuleConfig, quickAccessPaths: string[], onPinPath: (path: string) => void) {
		this.tracker = new DocumentTracker(app);
		this.quickAccessPaths = quickAccessPaths;
		this.onPinPath = onPinPath;
	}

	/** Renders the latest markdown file list into the given element. */
	renderContent(el: HTMLElement): void {
		const docs = this.tracker.getLatestMarkdown(12);
		if (docs.length === 0) {
			el.createDiv({ cls: 'vw-module-empty', text: 'No markdown files found' });
			return;
		}

		const list = el.createDiv({ cls: 'vw-doc-list' });
		for (const doc of docs) {
			const row = list.createDiv({ cls: 'vw-doc-row vw-doc-row-with-action' });
			const info = row.createDiv({ cls: 'vw-doc-info' });
			info.createSpan({ cls: 'vw-doc-link', text: doc.name });
			info.createSpan({ cls: 'vw-doc-meta', text: this.formatAddedAt(doc.createdAt) });

			const openIcon = row.createDiv({ cls: 'vw-doc-open-icon' });
			setDocIcon(openIcon);
			row.addEventListener('click', () => this.tracker.openFile(doc.path));

			const isPinned = this.quickAccessPaths.includes(doc.path);
			const pinBtn = row.createSpan({ cls: `vw-doc-pin ${isPinned ? 'vw-doc-pinned' : ''}` });
			setIcon(pinBtn, isPinned ? 'check' : 'pin');
			pinBtn.setAttribute('aria-label', isPinned ? 'Already in quick access' : 'Add to quick access');
			pinBtn.setAttribute('title', isPinned ? 'Already in quick access' : 'Add to quick access');
			pinBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				if (this.quickAccessPaths.includes(doc.path)) return;
				this.onPinPath(doc.path);
				if (this.quickAccessPaths.includes(doc.path) === false) {
					this.quickAccessPaths.push(doc.path);
				}
				this.refreshRow(pinBtn);
			});
		}
	}

	/** Marks the pin action as complete without forcing the full dashboard to rebuild. */
	private refreshRow(pinBtn: HTMLElement): void {
		pinBtn.addClass('vw-doc-pinned');
		pinBtn.empty();
		setIcon(pinBtn, 'check');
		pinBtn.setAttribute('aria-label', 'Already in quick access');
		pinBtn.setAttribute('title', 'Already in quick access');
	}

	/** Formats a creation timestamp for compact module display. */
	private formatAddedAt(createdAt: number | undefined): string {
		if (createdAt === undefined) return 'Added recently';
		const diffMs = Date.now() - createdAt;
		const minute = 60_000;
		const hour = 60 * minute;
		const day = 24 * hour;

		if (diffMs < minute) return 'Added just now';
		if (diffMs < hour) return `Added ${Math.floor(diffMs / minute)}m ago`;
		if (diffMs < day) return `Added ${Math.floor(diffMs / hour)}h ago`;
		if (diffMs < 7 * day) return `Added ${Math.floor(diffMs / day)}d ago`;
		return `Added ${new Date(createdAt).toLocaleDateString()}`;
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
