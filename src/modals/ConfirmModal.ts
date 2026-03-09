/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard Welcome
 * Description: Generic confirmation modal for destructive actions
 * Created: 2026-03-08
 * Last Modified: 2026-03-08
 */

import { App, Modal } from 'obsidian';

export class ConfirmModal extends Modal {
	private title: string;
	private message: string;
	private onConfirm: () => void;
	private confirmText: string;

	constructor(app: App, title: string, message: string, onConfirm: () => void, confirmText = 'Confirm') {
		super(app);
		this.title = title;
		this.message = message;
		this.onConfirm = onConfirm;
		this.confirmText = confirmText;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('vw-confirm-modal');

		contentEl.createEl('h3', { text: this.title });
		contentEl.createDiv({ cls: 'vw-confirm-desc', text: this.message });

		const actions = contentEl.createDiv({ cls: 'vw-confirm-actions' });

		const confirmBtn = actions.createEl('button', { cls: 'mod-warning', text: this.confirmText });
		confirmBtn.addEventListener('click', () => {
			this.close();
			this.onConfirm();
		});

		const cancelBtn = actions.createEl('button', { text: 'Cancel' });
		cancelBtn.addEventListener('click', () => this.close());
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
