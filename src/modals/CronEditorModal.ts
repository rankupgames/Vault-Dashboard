/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vaultboard
 * Description: Add/edit modal for dashboard-managed cron jobs
 * Created: 2026-05-13
 * Last Modified: 2026-05-13
 */

import { App, Modal, Notice, setIcon } from 'obsidian';
import { CRON_FREQUENCY, CRON_WEEKDAY, CronFrequency, CronJobConfig, CronWeekday } from '../core/types';
import { registerModal, unregisterModal } from '../core/modal-tracker';
import { WEEKDAY_LABELS } from '../services/CronRunner';

export interface CronEditorResult {
	title: string;
	description: string;
	prompt: string;
	frequency: CronFrequency;
	time: string;
	weekday: CronWeekday;
	outputFolder: string;
	workingDirectory: string;
}

interface CronEditorDefaults {
	title: string;
	description: string;
	prompt: string;
	frequency: CronFrequency;
	time: string;
	weekday: CronWeekday;
	outputFolder: string;
	workingDirectory: string;
}

const defaultValues = (job: CronJobConfig | null): CronEditorDefaults => ({
	title: job?.title ?? '',
	description: job?.description ?? '',
	prompt: job?.prompt ?? '',
	frequency: job?.frequency ?? CRON_FREQUENCY.DAILY,
	time: job?.time ?? '08:00',
	weekday: job?.weekday ?? CRON_WEEKDAY.MONDAY,
	outputFolder: job?.outputFolder ?? '',
	workingDirectory: job?.workingDirectory ?? '',
});

/** Modal used to create or edit a dashboard-managed scheduled report. */
export class CronEditorModal extends Modal {
	private job: CronJobConfig | null;
	private onSave: (result: CronEditorResult) => void;

	constructor(app: App, job: CronJobConfig | null, onSave: (result: CronEditorResult) => void) {
		super(app);
		this.job = job;
		this.onSave = onSave;
	}

	/** @override */
	onOpen(): void {
		registerModal(this);
		const values = defaultValues(this.job);
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('vw-cron-edit-modal');
		this.modalEl.querySelector('.modal-close-button')?.remove();

		const header = contentEl.createDiv({ cls: 'vw-modal-header-row' });
		header.createEl('h3', { text: this.job ? 'Edit scheduled task' : 'Create scheduled task' });
		const closeBtn = header.createDiv({ cls: 'vw-modal-header-icon-btn' });
		setIcon(closeBtn, 'x');
		closeBtn.setAttribute('aria-label', 'Close');
		closeBtn.setAttribute('tabindex', '0');
		closeBtn.addEventListener('click', () => this.close());

		const form = contentEl.createDiv({ cls: 'vw-edit-form' });

		form.createDiv({ cls: 'vw-edit-label', text: 'Name *' });
		const titleInput = form.createEl('input', {
			cls: 'vw-edit-input',
			attr: { type: 'text', placeholder: 'daily-briefing', value: values.title },
		});

		form.createDiv({ cls: 'vw-edit-label', text: 'Description *' });
		const descriptionInput = form.createEl('input', {
			cls: 'vw-edit-input',
			attr: { type: 'text', placeholder: 'Summarize my day', value: values.description },
		});

		const promptInput = form.createEl('textarea', {
			cls: 'vw-edit-textarea vw-cron-prompt-input',
			attr: { rows: '10', placeholder: 'Prompt to run on this schedule' },
		});
		promptInput.value = values.prompt;

		const commandBar = form.createDiv({ cls: 'vw-cron-command-bar' });
		commandBar.createDiv({ cls: 'vw-cron-command-pill', text: 'Work in a project' });
		commandBar.createDiv({ cls: 'vw-cron-command-pill', text: 'Ask' });
		commandBar.createDiv({ cls: 'vw-cron-command-pill vw-cron-command-pill-right', text: 'Default model' });

		form.createDiv({ cls: 'vw-edit-label', text: 'Working directory' });
		const workingDirInput = form.createEl('input', {
			cls: 'vw-edit-input',
			attr: { type: 'text', placeholder: 'Blank = repository root next to the Vault', value: values.workingDirectory },
		});

		const scheduleGrid = form.createDiv({ cls: 'vw-cron-schedule-grid' });
		const frequencyWrap = scheduleGrid.createDiv();
		frequencyWrap.createDiv({ cls: 'vw-edit-label', text: 'Frequency' });
		const frequencySelect = frequencyWrap.createEl('select', { cls: 'vw-edit-input' });
		this.addOption(frequencySelect, CRON_FREQUENCY.MANUAL, 'Manual', values.frequency);
		this.addOption(frequencySelect, CRON_FREQUENCY.DAILY, 'Daily', values.frequency);
		this.addOption(frequencySelect, CRON_FREQUENCY.WEEKLY, 'Weekly', values.frequency);

		const timeWrap = scheduleGrid.createDiv();
		timeWrap.createDiv({ cls: 'vw-edit-label', text: 'Time' });
		const timeInput = timeWrap.createEl('input', {
			cls: 'vw-edit-input',
			attr: { type: 'time', value: values.time },
		});

		const weekdayWrap = scheduleGrid.createDiv();
		weekdayWrap.createDiv({ cls: 'vw-edit-label', text: 'Weekday' });
		const weekdaySelect = weekdayWrap.createEl('select', { cls: 'vw-edit-input' });
		for (const weekday of Object.values(CRON_WEEKDAY)) {
			this.addOption(weekdaySelect, weekday, WEEKDAY_LABELS[weekday], values.weekday);
		}

		form.createDiv({ cls: 'vw-edit-label', text: 'Output folder' });
		const outputInput = form.createEl('input', {
			cls: 'vw-edit-input',
			attr: { type: 'text', placeholder: 'WorkspaceVault/Personal/ClaudeCRON/Daily Report', value: values.outputFolder },
		});

		const actions = contentEl.createDiv({ cls: 'vw-edit-actions' });
		actions.createDiv();
		const right = actions.createDiv({ cls: 'vw-edit-actions-right' });
		const cancelBtn = right.createEl('button', { text: 'Cancel' });
		cancelBtn.addEventListener('click', () => this.close());
		const saveBtn = right.createEl('button', { cls: 'mod-cta', text: 'Save' });
		saveBtn.addEventListener('click', () => {
			const title = titleInput.value.trim();
			const description = descriptionInput.value.trim();
			const prompt = promptInput.value.trim();
			if (title.length === 0 || description.length === 0 || prompt.length === 0) {
				new Notice('Name, description, and prompt are required');
				return;
			}
			this.onSave({
				title,
				description,
				prompt,
				frequency: frequencySelect.value as CronFrequency,
				time: timeInput.value || '08:00',
				weekday: weekdaySelect.value as CronWeekday,
				outputFolder: outputInput.value.trim() || `WorkspaceVault/Personal/ClaudeCRON/${title}`,
				workingDirectory: workingDirInput.value.trim(),
			});
			this.close();
		});
	}

	/** @override */
	onClose(): void {
		unregisterModal(this);
		this.contentEl.empty();
	}

	private addOption(select: HTMLSelectElement, value: string, label: string, selected: string): void {
		const option = select.createEl('option', { text: label, value });
		if (value === selected) option.selected = true;
	}
}
