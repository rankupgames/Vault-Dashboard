/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vaultboard
 * Description: Dashboard visualization, reports, categories, and module settings renderers
 * Created: 2026-07-12
 */

import { Setting } from 'obsidian';
import { DEFAULT_SETTINGS } from '../core/types';
import type { SettingsSectionContext } from './SettingsSectionContext';

/** Deletes a custom category and keeps automatic TODO imports pointed at a live category. */
export const deleteTaskCategory = async (context: SettingsSectionContext, categoryId: string): Promise<void> => {
	const settings = context.plugin.data.settings;
	context.plugin.taskManager.removeCategoryWithTasks(categoryId);
	if (settings.todoCategoryId === categoryId) {
		const fallbackCategory = settings.taskCategories.find((category) => category.id === DEFAULT_SETTINGS.todoCategoryId)
			?? settings.taskCategories[0];
		if (fallbackCategory !== undefined) settings.todoCategoryId = fallbackCategory.id;
	}
	await context.save();
	context.redisplay();
};

/** Renders the subtask tree branch color used to derive depth shades. */
export const renderTaskTreeSettings = (element: HTMLElement, context: SettingsSectionContext): void => {
	element.createEl('h2', { text: 'Task Tree' });
	const settings = context.plugin.data.settings;

	new Setting(element)
		.setName('Branch color')
		.setDesc('Base color for the task tree branches. Deeper subtasks use dimmer shades.')
		.addColorPicker((colorPicker) =>
			colorPicker.setValue(settings.branchColor).onChange(async (value) => {
				settings.branchColor = value;
				await context.save();
			}),
		);
};

/** Renders heatmap note location, tag filter, and generated color preferences. */
export const renderHeatmapSettings = (element: HTMLElement, context: SettingsSectionContext): void => {
	element.createEl('h2', { text: 'Heatmap' });
	const settings = context.plugin.data.settings;

	new Setting(element)
		.setName('Daily notes folder')
		.setDesc('Vault path to your daily notes folder for heatmap tag counting.')
		.addText((text) =>
			text
				.setPlaceholder('_DailyNotes')
				.setValue(settings.dailyNotesFolder)
				.onChange(async (value) => {
					settings.dailyNotesFolder = value.trim() || '_DailyNotes';
					await context.save();
				}),
		);

	new Setting(element)
		.setName('Tag filter')
		.setDesc('Tag prefix to count in daily notes (without #).')
		.addText((text) =>
			text
				.setPlaceholder('Task')
				.setValue(settings.heatmapTagFilter)
				.onChange(async (value) => {
					settings.heatmapTagFilter = value.trim() || 'Task';
					await context.save();
				}),
		);

	new Setting(element)
		.setName('Heatmap color')
		.setDesc('Base color for the heatmap. Four intensity shades are auto-generated.')
		.addColorPicker((colorPicker) =>
			colorPicker.setValue(settings.heatmapColor).onChange(async (value) => {
				settings.heatmapColor = value;
				await context.save();
			}),
		);
};

/** Renders report storage and per-source enablement controls. */
export const renderReportSettings = (element: HTMLElement, context: SettingsSectionContext): void => {
	element.createEl('h2', { text: 'Reports' });
	const settings = context.plugin.data.settings;

	new Setting(element)
		.setName('Report base folder')
		.setDesc('Vault path to the base folder containing report subfolders.')
		.addText((text) =>
			text
				.setPlaceholder('WorkspaceVault/Personal/ClaudeCRON')
				.setValue(settings.reportBasePath)
				.onChange(async (value) => {
					settings.reportBasePath = value.trim() || 'WorkspaceVault/Personal/ClaudeCRON';
					await context.save();
				}),
		);

	element.createEl('h3', { text: 'Report Sources' });
	for (const source of settings.reportSources) {
		new Setting(element)
			.setName(source.label)
			.setDesc(`${source.frequency} -- ${source.folder}`)
			.addToggle((toggle) =>
				toggle.setValue(source.enabled).onChange(async (value) => {
					source.enabled = value;
					await context.save();
				}),
			);
	}

	new Setting(element)
		.setName('Add report source')
		.addButton((button) =>
			button.setButtonText('Add').onClick(async () => {
				settings.reportSources.push({
					id: `custom-${Date.now()}`,
					label: 'New Source',
					folder: 'FolderName',
					patternStr: '^(.+)\\.(md|html)$',
					frequency: 'daily',
					enabled: true,
				});
				await context.save();
				context.redisplay();
			}),
		);
};

/** Renders category color, rename, deletion, and creation controls. */
export const renderCategorySettings = (element: HTMLElement, context: SettingsSectionContext): void => {
	element.createEl('h2', { text: 'Task Categories' });
	const settings = context.plugin.data.settings;
	const sortedCategories = [...settings.taskCategories].sort((first, second) => first.order - second.order);

	for (const category of sortedCategories) {
		const setting = new Setting(element).setName(category.name);
		if (category.isDefault) {
			setting.setDesc(category.dailyReset ? 'Default (daily reset)' : 'Default');
		}

		setting.addColorPicker((colorPicker) =>
			colorPicker.setValue(category.color ?? '#888888').onChange(async (value) => {
				category.color = value;
				await context.save();
			}),
		);

		if (category.isDefault === false || category.isDefault === undefined) {
			setting.addText((text) =>
				text.setValue(category.name).onChange(async (value) => {
					context.plugin.taskManager.renameCategory(category.id, value.trim() || category.name);
					await context.save();
				}),
			);

			setting.addButton((button) =>
				button.setButtonText('Delete + Tasks').setWarning().onClick(async () => {
					await deleteTaskCategory(context, category.id);
				}),
			);
		}
	}

	new Setting(element)
		.setName('Add category')
		.addButton((button) =>
			button.setButtonText('Add').onClick(async () => {
				context.plugin.taskManager.addCategory('New Category');
				await context.save();
				context.redisplay();
			}),
		);
};

/** Renders enablement switches for the dashboard's registered module configuration. */
export const renderModuleSettings = (element: HTMLElement, context: SettingsSectionContext): void => {
	element.createEl('h2', { text: 'Modules' });
	const settings = context.plugin.data.settings;

	for (const module of settings.modules) {
		new Setting(element)
			.setName(module.name)
			.addToggle((toggle) =>
				toggle.setValue(module.enabled).onChange(async (value) => {
					module.enabled = value;
					await context.save();
				}),
			);
	}
};
