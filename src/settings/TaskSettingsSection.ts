/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vaultboard
 * Description: Task behavior, automatic TODO, and tag settings renderers
 * Created: 2026-07-12
 */

import { setIcon, Setting } from 'obsidian';
import type { SettingsSectionContext } from './SettingsSectionContext';

/** Renders task behavior, automatic TODO ingestion, and archive controls. */
export const renderTaskSettings = (element: HTMLElement, context: SettingsSectionContext): void => {
	element.createEl('h2', { text: 'Tasks' });
	const settings = context.plugin.data.settings;

	new Setting(element)
		.setName('Multi-tag filter')
		.setDesc('Allow selecting multiple tags in the timeline filter.')
		.addToggle((toggle) =>
			toggle.setValue(settings.enableMultiTagFilter).onChange(async (value) => {
				settings.enableMultiTagFilter = value;
				await context.save();
			}),
		);

	new Setting(element)
		.setName('Image attachments')
		.setDesc('Allow attaching images to tasks.')
		.addToggle((toggle) =>
			toggle.setValue(settings.enableImageAttachments).onChange(async (value) => {
				settings.enableImageAttachments = value;
				await context.save();
			}),
		);

	new Setting(element)
		.setName('Confirmation dialogs')
		.setDesc('Show confirmation dialogs before destructive actions.')
		.addToggle((toggle) =>
			toggle.setValue(settings.showConfirmDialogs).onChange(async (value) => {
				settings.showConfirmDialogs = value;
				await context.save();
			}),
		);

	new Setting(element)
		.setName('Auto-archive after N days')
		.setDesc('Automatically archive completed/skipped tasks after this many days. Set to 0 to disable.')
		.addText((text) =>
			text
				.setPlaceholder('0')
				.setValue(String(settings.autoArchiveDays))
				.onChange(async (value) => {
					const parsedDays = parseInt(value, 10);
					settings.autoArchiveDays = Number.isNaN(parsedDays) || parsedDays < 0 ? 0 : parsedDays;
					await context.save();
				}),
		);

	new Setting(element)
		.setName('Automatic Vault TODO import')
		.setDesc('Add pending top-level Markdown checklists to the dashboard and keep one canonical source link per item.')
		.addToggle((toggle) =>
			toggle.setValue(settings.autoImportTodos).onChange(async (value) => {
				settings.autoImportTodos = value;
				await context.save();
				if (value) await context.plugin.syncVaultTodos(true).catch(() => undefined);
			}),
		);

	new Setting(element)
		.setName('TODO source folder')
		.setDesc('Vault-relative folder to scan. Leave blank to scan every Markdown note in the Vault.')
		.addText((text) =>
			text
				.setPlaceholder('WorkspaceVault/Business/Projects')
				.setValue(settings.todoSourceFolder)
				.onChange(async (value) => {
					settings.todoSourceFolder = value.trim();
					await context.save();
				}),
		);

	new Setting(element)
		.setName('Imported TODO duration')
		.setDesc('Default duration in minutes for automatically imported checklist items.')
		.addText((text) =>
			text
				.setPlaceholder('30')
				.setValue(String(settings.todoDefaultDurationMinutes))
				.onChange(async (value) => {
					const parsedDuration = parseInt(value, 10);
					settings.todoDefaultDurationMinutes = Number.isNaN(parsedDuration)
						? 30
						: Math.max(5, Math.min(480, parsedDuration));
					await context.save();
				}),
		);

	new Setting(element)
		.setName('Imported TODO destination')
		.setDesc('Automatic and manual Vault TODO imports always enter the immutable AI Tasks column. Use its Curate action when you want AI grouping.');

	new Setting(element)
		.setName('Sync Vault TODOs now')
		.setDesc('Scan the configured source folder immediately using the canonical reference registry.')
		.addButton((button) =>
			button
				.setButtonText('Sync now')
				.onClick(async () => {
					await context.plugin.syncVaultTodos(true).catch(() => undefined);
				}),
		);
};

/** Renders persistent tag creation, color management, and global removal controls. */
export const renderTagSettings = (element: HTMLElement, context: SettingsSectionContext): void => {
	element.createEl('h2', { text: 'Tags' });
	const settings = context.plugin.data.settings;
	const taskTags = context.plugin.taskManager.getAllTags();
	const allTags = Array.from(new Set([...settings.customTags, ...taskTags])).sort();

	const inputRow = element.createDiv({ cls: 'vw-settings-tag-input-row' });
	const tagInput = inputRow.createEl('input', {
		cls: 'vw-settings-tag-input',
		attr: { type: 'text', placeholder: 'Add new tag (Enter to add)' },
	});

	tagInput.addEventListener('keydown', async (event: KeyboardEvent) => {
		if (event.key !== 'Enter') return;
		event.preventDefault();
		const tag = tagInput.value.trim().toLowerCase();
		if (tag === '' || allTags.includes(tag)) return;
		settings.customTags.push(tag);
		await context.save();
		context.redisplay();
	});

	const pillWrapper = element.createDiv({ cls: 'vw-settings-tag-pills' });
	for (const tag of allTags) {
		const color = settings.tagColors[tag];
		const pill = pillWrapper.createDiv({ cls: 'vw-settings-tag-pill' });
		if (color) pill.style.borderColor = color;

		const dot = pill.createSpan({ cls: 'vw-settings-tag-dot' });
		dot.style.backgroundColor = color ?? '#888888';

		const hiddenPicker = pill.createEl('input', {
			cls: 'vw-settings-color-hidden',
			attr: { type: 'color', value: color ?? '#888888' },
		});
		dot.addEventListener('click', (event) => {
			event.stopPropagation();
			hiddenPicker.click();
		});
		hiddenPicker.addEventListener('input', async () => {
			const newColor = hiddenPicker.value;
			settings.tagColors[tag] = newColor;
			dot.style.backgroundColor = newColor;
			pill.style.borderColor = newColor;
			await context.save();
		});

		pill.createSpan({ cls: 'vw-settings-tag-name', text: tag });
		const removeButton = pill.createSpan({ cls: 'vw-settings-tag-x' });
		setIcon(removeButton, 'x');
		removeButton.addEventListener('click', async (event) => {
			event.stopPropagation();
			settings.customTags = settings.customTags.filter((candidate) => candidate !== tag);
			delete settings.tagColors[tag];
			context.plugin.taskManager.removeTagGlobally(tag);
			await context.save();
			context.redisplay();
		});
	}
};
