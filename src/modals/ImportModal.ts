/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard
 * Description: Modal for importing checklist items from vault notes as dashboard tasks
 * Created: 2026-03-08
 * Last Modified: 2026-03-08
 */

import { App, Modal, TFile, FuzzySuggestModal } from 'obsidian';
import { registerModal, unregisterModal } from '../core/modal-tracker';
import { TaskImporter, TaskImportItem } from '../services/TaskImporter';
import { SubTask } from '../core/types';

/** Single imported task result from the import modal. */
export interface ImportResult {
	title: string;
	durationMinutes: number;
	subtasks?: SubTask[];
}

/** Modal for importing checklist items from vault notes as dashboard tasks. */
export class ImportModal extends Modal {
	private onImport: (results: ImportResult[]) => void;
	private items: TaskImportItem[] = [];
	private defaultDuration = 30;
	private listEl: HTMLElement | null = null;

	/**
	 * @param app - Obsidian app instance
	 * @param onImport - Callback invoked with imported tasks when user confirms
	 */
	constructor(app: App, onImport: (results: ImportResult[]) => void) {
		super(app);
		this.onImport = onImport;
	}

	/** @override */
	onOpen(): void {
		registerModal(this);
		const { contentEl } = this;
		contentEl.addClass('vw-task-edit-modal');
		contentEl.createEl('h3', { text: 'Import Tasks from Note' });

		const form = contentEl.createDiv({ cls: 'vw-edit-form' });

		form.createDiv({ cls: 'vw-edit-label', text: 'Select a Note' });
		const pickBtn = form.createEl('button', { cls: 'vw-timer-btn', text: 'Choose File...' });
		const fileLabel = form.createDiv({ cls: 'vw-import-file-label', text: 'No file selected' });

		pickBtn.addEventListener('click', (e) => {
			e.preventDefault();
			new ImportFilePicker(this.app, async (file) => {
				fileLabel.setText(file.path);
				this.items = await TaskImporter.scanNote(this.app, file);
				this.renderItemList();
			}).open();
		});

		form.createDiv({ cls: 'vw-edit-label', text: 'Default Duration (minutes)' });
		const durInput = form.createEl('input', {
			cls: 'vw-edit-input',
			attr: { type: 'number', value: String(this.defaultDuration), min: '5', max: '480' },
		});
		durInput.addEventListener('change', () => {
			this.defaultDuration = Math.max(5, parseInt(durInput.value) || 30);
		});

		form.createDiv({ cls: 'vw-edit-label', text: 'Found Checklist Items' });
		this.listEl = form.createDiv({ cls: 'vw-import-list' });
		this.listEl.createDiv({ cls: 'vw-module-empty', text: 'Pick a note to scan for checklists' });

		const actions = form.createDiv({ cls: 'vw-edit-actions' });
		const importBtn = actions.createEl('button', { cls: 'vw-timer-btn vw-timer-btn-primary', text: 'Import Selected' });
		const cancelBtn = actions.createEl('button', { cls: 'vw-timer-btn', text: 'Cancel' });

		importBtn.addEventListener('click', () => {
			const selected = this.items.filter((it) => it.selected);
			if (selected.length === 0) return;
			const results: ImportResult[] = selected.map((it) => ({
				title: it.title,
				durationMinutes: this.defaultDuration,
				subtasks: it.subtasks.length > 0 ? it.subtasks : undefined,
			}));
			this.onImport(results);
			this.close();
		});

		cancelBtn.addEventListener('click', () => this.close());
	}

	/** @override */
	onClose(): void {
		unregisterModal(this);
		this.contentEl.empty();
	}

	/** Clears and re-renders the selectable checklist items from the parsed note. */
	private renderItemList(): void {
		if (this.listEl === null) return;
		this.listEl.empty();

		if (this.items.length === 0) {
			this.listEl.createDiv({ cls: 'vw-module-empty', text: 'No checklist items found in this note' });
			return;
		}

		for (const item of this.items) {
			const row = this.listEl.createDiv({ cls: 'vw-import-item' });
			const cb = row.createEl('input', { attr: { type: 'checkbox' } }) as HTMLInputElement;
			cb.checked = item.selected;
			cb.addEventListener('change', () => { item.selected = cb.checked; });

			const label = row.createSpan({ text: item.title });
			if (item.subtasks.length > 0) {
				label.createSpan({ cls: 'vw-import-sub-count', text: ` (+${item.subtasks.length} subtasks)` });
			}
		}
	}
}

class ImportFilePicker extends FuzzySuggestModal<TFile> {
	private onChoose_: (file: TFile) => void;

	constructor(app: App, onChoose: (file: TFile) => void) {
		super(app);
		this.onChoose_ = onChoose;
		this.setPlaceholder('Search for a note to import tasks from...');
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

	getItems(): TFile[] {
		return this.app.vault.getMarkdownFiles().sort((a, b) => b.stat.mtime - a.stat.mtime);
	}

	getItemText(file: TFile): string {
		return file.path;
	}

	onChooseItem(file: TFile): void {
		this.onChoose_(file);
	}
}
