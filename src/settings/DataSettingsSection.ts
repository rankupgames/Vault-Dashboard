/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vaultboard
 * Description: Task export and persisted onboarding data settings renderers
 * Created: 2026-07-12
 */

import { Notice, Setting } from 'obsidian';
import { AnalyticsExporter } from '../services/AnalyticsExporter';
import type { SettingsSectionContext } from './SettingsSectionContext';

/** Renders CSV download and daily-note append actions for task history. */
export const renderExportSettings = (element: HTMLElement, context: SettingsSectionContext): void => {
	element.createEl('h2', { text: 'Export' });

	new Setting(element)
		.setName('Export CSV')
		.setDesc('Download all tasks (active + archived) as a CSV file.')
		.addButton((button) =>
			button.setButtonText('Export').onClick(() => {
				const csv = AnalyticsExporter.exportToCSV(
					context.plugin.taskManager.toJSON(),
					context.plugin.taskManager.getArchivedTasks(),
				);
				AnalyticsExporter.downloadCSV(csv, 'vaultboard-tasks.csv');
				new Notice('CSV exported');
			}),
		);

	new Setting(element)
		.setName('Append to Daily Note')
		.setDesc('Append today\'s task summary to the daily note.')
		.addButton((button) =>
			button.setButtonText('Append').onClick(async () => {
				await AnalyticsExporter.exportToDailyNote(
					context.app,
					context.plugin.taskManager.toJSON(),
					context.plugin.data.settings.dailyNotesFolder,
				);
				new Notice('Appended to daily note');
			}),
		);
};

/** Renders persisted onboarding reset controls. */
export const renderDataSettings = (element: HTMLElement, context: SettingsSectionContext): void => {
	element.createEl('h2', { text: 'Data' });
	const settings = context.plugin.data.settings;

	new Setting(element)
		.setName('Re-show welcome guide')
		.setDesc('Reset so the welcome modal appears on next dashboard open.')
		.addButton((button) =>
			button
				.setButtonText(settings.hasSeenOnboarding ? 'Reset' : 'Already showing')
				.setDisabled(settings.hasSeenOnboarding === false)
				.onClick(async () => {
					settings.hasSeenOnboarding = false;
					await context.save();
					context.redisplay();
				}),
		);
};
