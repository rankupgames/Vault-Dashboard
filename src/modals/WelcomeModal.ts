/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard
 * Description: First-open welcome modal listing instructions and features
 * Created: 2026-03-13
 * Last Modified: 2026-03-13
 */

import { App, Modal, setIcon } from 'obsidian';

interface FeatureItem {
	icon: string;
	title: string;
	description: string;
}

const FEATURES: FeatureItem[] = [
	{
		icon: 'plus-circle',
		title: 'Add Tasks',
		description: 'Click "+ Add Task" in the timeline to create timed tasks with titles, durations, subtasks, and tags.',
	},
	{
		icon: 'play-circle',
		title: 'Clock-Aligned Timer',
		description: 'Press play on any task to start a timer that snaps to the next clean time boundary (hour or half-hour).',
	},
	{
		icon: 'kanban',
		title: 'Board View',
		description: 'Switch to the Kanban board for a column-based overview of your tasks by status.',
	},
	{
		icon: 'layout-grid',
		title: 'Collapsible Modules',
		description: 'The right panel has widgets: daily/weekly reports, quick access docs, and a heatmap tracker. Toggle and reorder them.',
	},
	{
		icon: 'tag',
		title: 'Tags & Categories',
		description: 'Organize tasks with color-coded tags and categories for quick filtering.',
	},
	{
		icon: 'timer',
		title: 'Pomodoro Mode',
		description: 'Enable pomodoro mode in settings for automatic work/break cycles with configurable durations.',
	},
	{
		icon: 'keyboard',
		title: 'Keyboard Shortcuts',
		description: 'Use hotkeys to quickly add tasks, toggle the timer, and navigate between views.',
	},
	{
		icon: 'import',
		title: 'Import from Notes',
		description: 'Pull checklists from your vault notes directly into the task timeline.',
	},
];

/** First-open welcome modal that lists plugin instructions and features. */
export class WelcomeModal extends Modal {
	private onDismiss: () => void;

	/**
	 * @param app - Obsidian app instance
	 * @param onDismiss - Callback invoked when the modal is closed
	 */
	constructor(app: App, onDismiss: () => void) {
		super(app);
		this.onDismiss = onDismiss;
	}

	/** @override */
	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('vw-welcome-modal');

		contentEl.createEl('h2', { text: 'Welcome to Vault Dashboard' });
		contentEl.createDiv({
			cls: 'vw-welcome-subtitle',
			text: 'Here\'s what you can do:',
		});

		const list = contentEl.createDiv({ cls: 'vw-welcome-list' });

		for (const feature of FEATURES) {
			const row = list.createDiv({ cls: 'vw-welcome-item' });
			const iconEl = row.createSpan({ cls: 'vw-welcome-item-icon' });
			setIcon(iconEl, feature.icon);
			const text = row.createDiv({ cls: 'vw-welcome-item-text' });
			text.createDiv({ cls: 'vw-welcome-item-title', text: feature.title });
			text.createDiv({ cls: 'vw-welcome-item-desc', text: feature.description });
		}

		const actions = contentEl.createDiv({ cls: 'vw-welcome-actions' });
		const btn = actions.createEl('button', { cls: 'mod-cta', text: 'Get Started' });
		btn.addEventListener('click', () => this.close());
	}

	/** @override */
	onClose(): void {
		this.contentEl.empty();
		this.onDismiss();
	}
}
