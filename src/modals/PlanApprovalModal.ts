/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard Welcome
 * Description: Modal for reviewing and approving an AI-generated execution plan
 * Created: 2026-03-09
 * Last Modified: 2026-03-09
 */

import { App, Component, MarkdownRenderer, Modal } from 'obsidian';
import type { DispatchRecord } from '../services/AIDispatcher';

/** Modal that renders an AI plan and lets the user approve or reject it. */
export class PlanApprovalModal extends Modal {
	private record: DispatchRecord;
	private onApprove: (() => void) | null;
	private onReject: (() => void) | null;
	private readOnly: boolean;
	private renderComponent: Component;

	/**
	 * @param app - Obsidian app instance
	 * @param record - The dispatch record containing planText
	 * @param onApprove - Callback invoked when the user approves the plan (null for read-only preview)
	 * @param onReject - Callback invoked when the user rejects the plan (null for read-only preview)
	 */
	constructor(app: App, record: DispatchRecord, onApprove: (() => void) | null, onReject: (() => void) | null) {
		super(app);
		this.record = record;
		this.onApprove = onApprove;
		this.onReject = onReject;
		this.readOnly = onApprove === null && onReject === null;
		this.renderComponent = new Component();
	}

	/** @override */
	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('vw-plan-modal');

		const title = this.readOnly
			? `Plan Preview: ${this.record.taskTitle}`
			: `AI Plan: ${this.record.taskTitle}`;
		contentEl.createEl('h3', { text: title });

		const body = contentEl.createDiv({ cls: 'vw-plan-modal-body' });
		const planText = this.record.planText?.trim() || '(no plan text)';

		this.renderComponent.load();
		void MarkdownRenderer.render(this.app, planText, body, '', this.renderComponent);

		if (this.readOnly === false) {
			const actions = contentEl.createDiv({ cls: 'vw-confirm-actions' });

			const approveBtn = actions.createEl('button', { cls: 'mod-cta', text: 'Approve & Execute' });
			approveBtn.addEventListener('click', () => {
				this.close();
				this.onApprove?.();
			});

			const rejectBtn = actions.createEl('button', { text: 'Reject' });
			rejectBtn.addEventListener('click', () => {
				this.close();
				this.onReject?.();
			});
		} else {
			const actions = contentEl.createDiv({ cls: 'vw-confirm-actions' });
			const closeBtn = actions.createEl('button', { text: 'Close' });
			closeBtn.addEventListener('click', () => this.close());
		}
	}

	/** @override */
	onClose(): void {
		this.renderComponent.unload();
		this.contentEl.empty();
	}
}
