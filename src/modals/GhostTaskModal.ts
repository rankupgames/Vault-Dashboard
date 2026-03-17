/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard
 * Description: Lightweight modal for creating a ghost task (timer-only, no task card)
 * Created: 2026-03-17
 * Last Modified: 2026-03-17
 */

import { App, Modal, setIcon } from 'obsidian';
import { registerModal, unregisterModal } from '../core/modal-tracker';
import type { GhostTaskInfo } from '../core/ghost-task';

/** Lightweight modal for starting a ghost task with a name and duration. */
export class GhostTaskModal extends Modal {
	private onStart: (info: GhostTaskInfo) => void;
	private durHours = 0;
	private durMins = 30;
	private nameInput: HTMLInputElement | null = null;
	private hoursDisplay: HTMLElement | null = null;
	private minsDisplay: HTMLElement | null = null;

	constructor(app: App, onStart: (info: GhostTaskInfo) => void) {
		super(app);
		this.onStart = onStart;
	}

	/** @override */
	onOpen(): void {
		registerModal(this);
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('vw-ghost-modal');
		this.modalEl.querySelector('.modal-close-button')?.remove();

		contentEl.createEl('h3', { text: 'Quick Timer', cls: 'vw-ghost-title' });

		const form = contentEl.createDiv({ cls: 'vw-edit-form' });

		form.createDiv({ cls: 'vw-edit-label', text: 'Name' });
		this.nameInput = form.createEl('input', {
			cls: 'vw-edit-input',
			type: 'text',
			placeholder: 'Quick Timer',
		});

		form.createDiv({ cls: 'vw-edit-label', text: 'Duration' });
		const durRow = form.createDiv({ cls: 'vw-duration-stepper' });

		this.hoursDisplay = durRow.createDiv({ cls: 'vw-dur-display' });
		this.minsDisplay = durRow.createDiv({ cls: 'vw-dur-display' });
		this.updateDurDisplay();

		const stepHours = (d: number): void => {
			this.durHours = Math.max(0, Math.min(23, this.durHours + d));
			this.updateDurDisplay();
		};
		const stepMins = (d: number): void => {
			this.durMins += d;
			if (this.durMins >= 60) { this.durMins = 0; stepHours(1); return; }
			if (this.durMins < 0) { this.durMins = 55; stepHours(-1); return; }
			this.updateDurDisplay();
		};

		durRow.empty();
		this.buildStepper(durRow, this.hoursDisplay!, (d) => stepHours(d));
		durRow.createDiv({ cls: 'vw-dur-sep', text: ':' });
		this.buildStepper(durRow, this.minsDisplay!, (d) => stepMins(d * 5));
		this.updateDurDisplay();

		const actions = contentEl.createDiv({ cls: 'vw-edit-actions' });
		const spacer = actions.createDiv({ cls: 'vw-edit-actions-left' });
		spacer.style.flex = '1';
		const right = actions.createDiv({ cls: 'vw-edit-actions-right' });

		const startBtn = right.createEl('button', { cls: 'vw-timer-btn vw-timer-btn-primary', text: 'Start' });
		startBtn.addEventListener('click', () => this.submit());

		const cancelBtn = right.createEl('button', { cls: 'vw-timer-btn', text: 'Cancel' });
		cancelBtn.addEventListener('click', () => this.close());

		this.nameInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') { e.preventDefault(); this.submit(); }
		});

		setTimeout(() => this.nameInput?.focus(), 50);
	}

	/** @override */
	onClose(): void {
		unregisterModal(this);
		this.contentEl.empty();
	}

	private updateDurDisplay(): void {
		this.hoursDisplay?.setText(`${this.durHours}h`);
		this.minsDisplay?.setText(`${this.durMins}m`);
	}

	private buildStepper(row: HTMLElement, display: HTMLElement, onStep: (d: number) => void): void {
		const group = row.createDiv({ cls: 'vw-dur-group' });
		const minus = group.createEl('button', { cls: 'vw-dur-btn' });
		setIcon(minus, 'minus');
		group.appendChild(display);
		const plus = group.createEl('button', { cls: 'vw-dur-btn' });
		setIcon(plus, 'plus');
		minus.addEventListener('click', (e) => { e.preventDefault(); onStep(-1); });
		plus.addEventListener('click', (e) => { e.preventDefault(); onStep(1); });
	}

	private submit(): void {
		const name = this.nameInput?.value.trim() || 'Quick Timer';
		const dur = Math.max(5, this.durHours * 60 + this.durMins);
		this.close();
		this.onStart({ name, durationMinutes: dur });
	}
}
