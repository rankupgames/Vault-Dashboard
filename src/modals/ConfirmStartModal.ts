/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard Welcome
 * Description: Confirmation modal when starting a task while another is active
 * Created: 2026-03-08
 * Last Modified: 2026-03-08
 */

import { App, Modal } from 'obsidian';

export type ConfirmStartChoice = 'start-now' | 'queue-next' | 'cancel';

export class ConfirmStartModal extends Modal {
	private activeTaskTitle: string;
	private newTaskTitle: string;
	private onChoice: (choice: ConfirmStartChoice) => void;

	constructor(app: App, activeTaskTitle: string, newTaskTitle: string, onChoice: (choice: ConfirmStartChoice) => void) {
		super(app);
		this.activeTaskTitle = activeTaskTitle;
		this.newTaskTitle = newTaskTitle;
		this.onChoice = onChoice;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('vw-confirm-start-modal');

		contentEl.createEl('h3', { text: 'Task already running' });

		const desc = contentEl.createDiv({ cls: 'vw-confirm-desc' });
		desc.createEl('strong', { text: this.activeTaskTitle });
		desc.createSpan({ text: ' is currently active. What do you want to do with ' });
		desc.createEl('strong', { text: this.newTaskTitle });
		desc.createSpan({ text: '?' });

		const actions = contentEl.createDiv({ cls: 'vw-confirm-actions' });

		const startBtn = actions.createEl('button', { cls: 'mod-cta', text: 'Start Now' });
		startBtn.addEventListener('click', () => {
			this.close();
			this.onChoice('start-now');
		});

		const queueBtn = actions.createEl('button', { text: 'Queue Next' });
		queueBtn.addEventListener('click', () => {
			this.close();
			this.onChoice('queue-next');
		});

		const cancelBtn = actions.createEl('button', { text: 'Cancel' });
		cancelBtn.addEventListener('click', () => {
			this.close();
			this.onChoice('cancel');
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
