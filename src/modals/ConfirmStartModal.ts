/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard
 * Description: Confirmation modal when starting a task while another is active
 * Created: 2026-03-08
 * Last Modified: 2026-03-08
 */

import { App, Modal } from 'obsidian';

/** User choice when starting a task while another is active. */
export type ConfirmStartChoice = 'start-now' | 'queue-next' | 'cancel';

/** Confirmation modal when starting a task while another is active. */
export class ConfirmStartModal extends Modal {
	private activeTaskTitle: string;
	private newTaskTitle: string;
	private onChoice: (choice: ConfirmStartChoice) => void;

	/**
	 * @param app - Obsidian app instance
	 * @param activeTaskTitle - Title of the currently running task
	 * @param newTaskTitle - Title of the task user wants to start
	 * @param onChoice - Callback invoked with user's choice
	 */
	constructor(app: App, activeTaskTitle: string, newTaskTitle: string, onChoice: (choice: ConfirmStartChoice) => void) {
		super(app);
		this.activeTaskTitle = activeTaskTitle;
		this.newTaskTitle = newTaskTitle;
		this.onChoice = onChoice;
	}

	/** @override */
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

	/** @override */
	onClose(): void {
		this.contentEl.empty();
	}
}
