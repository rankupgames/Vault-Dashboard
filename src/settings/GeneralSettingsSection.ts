/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vaultboard
 * Description: General, timer, and audio settings section renderers
 * Created: 2026-07-12
 */

import { Setting } from 'obsidian';
import { DEFAULT_SETTINGS } from '../core/types';
import type { SettingsSectionContext } from './SettingsSectionContext';

/** Renders startup, pinning, and generated-output preferences. */
export const renderGeneralSettings = (element: HTMLElement, context: SettingsSectionContext): void => {
	element.createEl('h2', { text: 'General' });
	const settings = context.plugin.data.settings;

	new Setting(element)
		.setName('Auto-open on startup')
		.setDesc('Automatically open the dashboard when Obsidian starts.')
		.addToggle((toggle) =>
			toggle.setValue(settings.autoOpenOnStartup).onChange(async (value) => {
				settings.autoOpenOnStartup = value;
				await context.save();
			}),
		);

	new Setting(element)
		.setName('Pin as first tab')
		.setDesc('Keep the dashboard pinned as the first tab. Requires restart to take effect.')
		.addToggle((toggle) =>
			toggle.setValue(settings.autoPinTab).onChange(async (value) => {
				settings.autoPinTab = value;
				await context.save();
			}),
		);

	new Setting(element)
		.setName('Output folder')
		.setDesc('Base folder for all plugin-generated files (AI prompts, attachments, pasted documents). Subfolders are created per task.')
		.addText((text) =>
			text
				.setPlaceholder(DEFAULT_SETTINGS.outputFolder)
				.setValue(settings.outputFolder)
				.onChange(async (value) => {
					settings.outputFolder = value.trim() || DEFAULT_SETTINGS.outputFolder;
					await context.save();
				}),
		);
};

/** Renders timer mode controls and only the settings relevant to the selected mode. */
export const renderTimerSettings = (element: HTMLElement, context: SettingsSectionContext): void => {
	element.createEl('h2', { text: 'Timer' });
	const settings = context.plugin.data.settings;

	new Setting(element)
		.setName('Default timer mode')
		.setDesc('Clock-aligned snaps to clock boundaries. Pomodoro uses fixed work/break intervals.')
		.addDropdown((dropdown) =>
			dropdown
				.addOption('clock-aligned', 'Clock-Aligned')
				.addOption('pomodoro', 'Pomodoro')
				.setValue(settings.timerMode)
				.onChange(async (value) => {
					settings.timerMode = value as 'clock-aligned' | 'pomodoro';
					await context.save();
					context.redisplay();
				}),
		);

	if (settings.timerMode === 'clock-aligned') {
		new Setting(element)
			.setName('Snap interval')
			.setDesc('Clock boundary interval in minutes. Timer end times align to these boundaries.')
			.addDropdown((dropdown) =>
				dropdown
					.addOption('15', '15 minutes')
					.addOption('30', '30 minutes')
					.addOption('60', '60 minutes')
					.setValue(String(settings.snapIntervalMinutes))
					.onChange(async (value) => {
						settings.snapIntervalMinutes = parseInt(value);
						context.plugin.timerEngine.setSnapInterval(settings.snapIntervalMinutes);
						await context.save();
					}),
			);
	}

	if (settings.timerMode === 'pomodoro') {
		new Setting(element)
			.setName('Work duration')
			.setDesc('Minutes per work session.')
			.addSlider((slider) =>
				slider
					.setLimits(5, 90, 5)
					.setValue(settings.pomodoroWorkMinutes)
					.setDynamicTooltip()
					.onChange(async (value) => {
						settings.pomodoroWorkMinutes = value;
						await context.save();
					}),
			);

		new Setting(element)
			.setName('Short break')
			.setDesc('Minutes for short breaks between work sessions.')
			.addSlider((slider) =>
				slider
					.setLimits(1, 30, 1)
					.setValue(settings.pomodoroBreakMinutes)
					.setDynamicTooltip()
					.onChange(async (value) => {
						settings.pomodoroBreakMinutes = value;
						await context.save();
					}),
			);

		new Setting(element)
			.setName('Long break')
			.setDesc('Minutes for the long break after a full cycle.')
			.addSlider((slider) =>
				slider
					.setLimits(5, 60, 5)
					.setValue(settings.pomodoroLongBreakMinutes)
					.setDynamicTooltip()
					.onChange(async (value) => {
						settings.pomodoroLongBreakMinutes = value;
						await context.save();
					}),
			);

		new Setting(element)
			.setName('Sessions before long break')
			.setDesc('Number of work sessions before a long break.')
			.addSlider((slider) =>
				slider
					.setLimits(2, 8, 1)
					.setValue(settings.pomodoroLongBreakInterval)
					.setDynamicTooltip()
					.onChange(async (value) => {
						settings.pomodoroLongBreakInterval = value;
						await context.save();
					}),
			);
	}
};

/** Renders the master audio switch and event-specific notification controls. */
export const renderAudioSettings = (element: HTMLElement, context: SettingsSectionContext): void => {
	element.createEl('h2', { text: 'Audio' });
	const settings = context.plugin.data.settings;

	new Setting(element)
		.setName('Enable audio')
		.setDesc('Play sound notifications for timer events.')
		.addToggle((toggle) =>
			toggle.setValue(settings.audioEnabled).onChange(async (value) => {
				settings.audioEnabled = value;
				await context.save();
				context.redisplay();
			}),
		);

	if (settings.audioEnabled) {
		new Setting(element)
			.setName('Sound on task complete')
			.setDesc('Play a chime when a task timer finishes.')
			.addToggle((toggle) =>
				toggle.setValue(settings.audioOnComplete).onChange(async (value) => {
					settings.audioOnComplete = value;
					await context.save();
				}),
			);

		new Setting(element)
			.setName('Sound on overtime')
			.setDesc('Play a warning tone when the timer goes negative.')
			.addToggle((toggle) =>
				toggle.setValue(settings.audioOnNegative).onChange(async (value) => {
					settings.audioOnNegative = value;
					await context.save();
				}),
			);
	}
};
