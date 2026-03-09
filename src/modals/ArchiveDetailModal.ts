/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard Welcome
 * Description: Detail modal for archived tasks with restore and delete actions
 * Created: 2026-03-08
 * Last Modified: 2026-03-08
 */

import { App, Modal, setIcon } from 'obsidian';
import { Task, PluginSettings } from '../types';

export class ArchiveDetailModal extends Modal {
	private task: Task;
	private settings: PluginSettings;
	private onRestore: () => void;
	private onDelete: () => void;

	constructor(app: App, task: Task, settings: PluginSettings, onRestore: () => void, onDelete: () => void) {
		super(app);
		this.task = task;
		this.settings = settings;
		this.onRestore = onRestore;
		this.onDelete = onDelete;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('vw-archive-detail-modal');

		contentEl.createEl('h3', { text: this.task.title });

		const info = contentEl.createDiv({ cls: 'vw-archive-detail-info' });

		const formatDur = (m: number): string => {
			const h = Math.floor(m / 60);
			const mins = m % 60;
			if (h > 0 && mins > 0) return `${h}h ${mins}m`;
			if (h > 0) return `${h}h`;
			return `${mins}m`;
		};

		info.createDiv({ text: `Estimated: ${formatDur(this.task.durationMinutes)}` });
		if (this.task.actualDurationMinutes !== undefined) {
			info.createDiv({ text: `Actual: ${formatDur(this.task.actualDurationMinutes)}` });
		}
		if (this.task.completedAt) {
			info.createDiv({ text: `Completed: ${new Date(this.task.completedAt).toLocaleDateString()}` });
		}
		if (this.task.status === 'skipped') {
			info.createDiv({ cls: 'vw-archive-detail-skipped', text: 'Skipped' });
		}

		if (this.task.tags && this.task.tags.length > 0) {
			const tagArea = contentEl.createDiv({ cls: 'vw-tag-pills' });
			for (const tag of this.task.tags) {
				const pill = tagArea.createSpan({ cls: 'vw-tag-pill', text: tag });
				const color = this.settings.tagColors[tag];
				if (color) pill.style.backgroundColor = color;
			}
		}

		if (this.task.description) {
			const descEl = contentEl.createDiv({ cls: 'vw-archive-detail-desc' });
			descEl.setText(this.task.description);
		}

		const actions = contentEl.createDiv({ cls: 'vw-confirm-actions' });

		const restoreBtn = actions.createEl('button', { cls: 'mod-cta' });
		const restoreIcon = restoreBtn.createSpan({ cls: 'vw-btn-icon' });
		setIcon(restoreIcon, 'undo-2');
		restoreBtn.createSpan({ text: ' Restore' });
		restoreBtn.addEventListener('click', () => {
			this.close();
			this.onRestore();
		});

		const deleteBtn = actions.createEl('button', { cls: 'mod-warning' });
		const deleteIcon = deleteBtn.createSpan({ cls: 'vw-btn-icon' });
		setIcon(deleteIcon, 'trash-2');
		deleteBtn.createSpan({ text: ' Delete' });
		deleteBtn.addEventListener('click', () => {
			this.close();
			this.onDelete();
		});

		const cancelBtn = actions.createEl('button', { text: 'Close' });
		cancelBtn.addEventListener('click', () => this.close());
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
