/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard
 * Description: Modal for creating or renaming a task board category
 * Created: 2026-03-13
 * Last Modified: 2026-03-13
 */

import { App, Modal } from 'obsidian';
import { registerModal, unregisterModal } from '../core/modal-tracker';

/** Result returned when the category modal is saved. */
export interface CategoryModalResult {
	name: string;
	color?: string;
}

/** Modal for creating or renaming a task board category. */
export class CategoryModal extends Modal {
	private onSave: (result: CategoryModalResult) => void;
	private initialName: string;
	private initialColor: string;
	private heading: string;

	constructor(
		app: App,
		heading: string,
		onSave: (result: CategoryModalResult) => void,
		initialName = '',
		initialColor = '',
	) {
		super(app);
		this.heading = heading;
		this.onSave = onSave;
		this.initialName = initialName;
		this.initialColor = initialColor;
	}

	/** @override */
	onOpen(): void {
		registerModal(this);
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('vw-confirm-modal');

		contentEl.createEl('h3', { text: this.heading });

		const form = contentEl.createDiv({ cls: 'vw-edit-form' });

		form.createDiv({ cls: 'vw-edit-label', text: 'Name' });
		const nameInput = form.createEl('input', {
			cls: 'vw-edit-input',
			attr: { type: 'text', placeholder: 'Category name', value: this.initialName },
		});

		form.createDiv({ cls: 'vw-edit-label', text: 'Color (optional)' });
		const colorRow = form.createDiv({ cls: 'vw-duration-stepper' });
		const colorInput = colorRow.createEl('input', {
			cls: 'vw-edit-input',
			attr: { type: 'color', value: this.initialColor || '#6c6c6c' },
		});
		colorInput.style.width = '48px';
		colorInput.style.height = '32px';
		colorInput.style.padding = '2px';
		colorInput.style.cursor = 'pointer';

		const colorLabel = colorRow.createSpan({ cls: 'vw-edit-label', text: this.initialColor || 'none' });
		colorLabel.style.marginLeft = '8px';

		let colorPicked = this.initialColor !== '';
		colorInput.addEventListener('input', () => {
			colorPicked = true;
			colorLabel.setText(colorInput.value);
		});

		const actions = contentEl.createDiv({ cls: 'vw-confirm-actions' });

		const saveBtn = actions.createEl('button', {
			cls: 'mod-cta',
			text: this.initialName ? 'Save' : 'Create',
		});
		const cancelBtn = actions.createEl('button', { text: 'Cancel' });

		const doSave = (): void => {
			const name = nameInput.value.trim();
			if (name === '') return;
			this.onSave({
				name,
				color: colorPicked ? colorInput.value : undefined,
			});
			this.close();
		};

		saveBtn.addEventListener('click', doSave);
		cancelBtn.addEventListener('click', () => this.close());
		nameInput.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter') { e.preventDefault(); doSave(); }
		});

		requestAnimationFrame(() => {
			nameInput.focus();
			if (this.initialName) nameInput.select();
		});
	}

	/** @override */
	onClose(): void {
		unregisterModal(this);
		this.contentEl.empty();
	}
}
