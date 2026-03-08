/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard Welcome
 * Description: Plugin settings tab for Obsidian Settings panel
 * Created: 2026-03-08
 * Last Modified: 2026-03-08
 */

import { App, PluginSettingTab, Setting } from 'obsidian';
import type VaultWelcomePlugin from './main';

export class SettingsTab extends PluginSettingTab {
	private plugin: VaultWelcomePlugin;

	constructor(app: App, plugin: VaultWelcomePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		this.renderGeneralSection(containerEl);
		this.renderTimerSection(containerEl);
		this.renderAudioSection(containerEl);
		this.renderTaskTreeSection(containerEl);
		this.renderHeatmapSection(containerEl);
		this.renderReportsSection(containerEl);
		this.renderModulesSection(containerEl);
		this.renderDataSection(containerEl);
	}

	private renderGeneralSection(el: HTMLElement): void {
		el.createEl('h2', { text: 'General' });

		const settings = this.plugin.data.settings;

		new Setting(el)
			.setName('Auto-open on startup')
			.setDesc('Automatically open the dashboard when Obsidian starts.')
			.addToggle((toggle) =>
				toggle.setValue(settings.autoOpenOnStartup).onChange(async (val) => {
					settings.autoOpenOnStartup = val;
					await this.save();
				}),
			);

		new Setting(el)
			.setName('Pin as first tab')
			.setDesc('Keep the dashboard pinned as the first tab. Requires restart to take effect.')
			.addToggle((toggle) =>
				toggle.setValue(settings.autoPinTab).onChange(async (val) => {
					settings.autoPinTab = val;
					await this.save();
				}),
			);
	}

	private renderTimerSection(el: HTMLElement): void {
		el.createEl('h2', { text: 'Timer' });

		const settings = this.plugin.data.settings;

		new Setting(el)
			.setName('Default timer mode')
			.setDesc('Clock-aligned snaps to clock boundaries. Pomodoro uses fixed work/break intervals.')
			.addDropdown((dd) =>
				dd
					.addOption('clock-aligned', 'Clock-Aligned')
					.addOption('pomodoro', 'Pomodoro')
					.setValue(settings.timerMode)
					.onChange(async (val) => {
						settings.timerMode = val as 'clock-aligned' | 'pomodoro';
						await this.save();
						this.display();
					}),
			);

		if (settings.timerMode === 'clock-aligned') {
			new Setting(el)
				.setName('Snap interval')
				.setDesc('Clock boundary interval in minutes. Timer end times align to these boundaries.')
				.addDropdown((dd) =>
					dd
						.addOption('15', '15 minutes')
						.addOption('30', '30 minutes')
						.addOption('60', '60 minutes')
						.setValue(String(settings.snapIntervalMinutes))
						.onChange(async (val) => {
							settings.snapIntervalMinutes = parseInt(val);
							this.plugin.timerEngine.setSnapInterval(settings.snapIntervalMinutes);
							await this.save();
						}),
				);
		}

		if (settings.timerMode === 'pomodoro') {
			new Setting(el)
				.setName('Work duration')
				.setDesc('Minutes per work session.')
				.addSlider((slider) =>
					slider
						.setLimits(5, 90, 5)
						.setValue(settings.pomodoroWorkMinutes)
						.setDynamicTooltip()
						.onChange(async (val) => {
							settings.pomodoroWorkMinutes = val;
							await this.save();
						}),
				);

			new Setting(el)
				.setName('Short break')
				.setDesc('Minutes for short breaks between work sessions.')
				.addSlider((slider) =>
					slider
						.setLimits(1, 30, 1)
						.setValue(settings.pomodoroBreakMinutes)
						.setDynamicTooltip()
						.onChange(async (val) => {
							settings.pomodoroBreakMinutes = val;
							await this.save();
						}),
				);

			new Setting(el)
				.setName('Long break')
				.setDesc('Minutes for the long break after a full cycle.')
				.addSlider((slider) =>
					slider
						.setLimits(5, 60, 5)
						.setValue(settings.pomodoroLongBreakMinutes)
						.setDynamicTooltip()
						.onChange(async (val) => {
							settings.pomodoroLongBreakMinutes = val;
							await this.save();
						}),
				);

			new Setting(el)
				.setName('Sessions before long break')
				.setDesc('Number of work sessions before a long break.')
				.addSlider((slider) =>
					slider
						.setLimits(2, 8, 1)
						.setValue(settings.pomodoroLongBreakInterval)
						.setDynamicTooltip()
						.onChange(async (val) => {
							settings.pomodoroLongBreakInterval = val;
							await this.save();
						}),
				);
		}
	}

	private renderAudioSection(el: HTMLElement): void {
		el.createEl('h2', { text: 'Audio' });

		const settings = this.plugin.data.settings;

		new Setting(el)
			.setName('Enable audio')
			.setDesc('Play sound notifications for timer events.')
			.addToggle((toggle) =>
				toggle.setValue(settings.audioEnabled).onChange(async (val) => {
					settings.audioEnabled = val;
					await this.save();
					this.display();
				}),
			);

		if (settings.audioEnabled) {
			new Setting(el)
				.setName('Sound on task complete')
				.setDesc('Play a chime when a task timer finishes.')
				.addToggle((toggle) =>
					toggle.setValue(settings.audioOnComplete).onChange(async (val) => {
						settings.audioOnComplete = val;
						await this.save();
					}),
				);

			new Setting(el)
				.setName('Sound on overtime')
				.setDesc('Play a warning tone when the timer goes negative.')
				.addToggle((toggle) =>
					toggle.setValue(settings.audioOnNegative).onChange(async (val) => {
						settings.audioOnNegative = val;
						await this.save();
					}),
				);
		}
	}

	private renderHeatmapSection(el: HTMLElement): void {
		el.createEl('h2', { text: 'Heatmap' });

		const settings = this.plugin.data.settings;

		new Setting(el)
			.setName('Daily notes folder')
			.setDesc('Vault path to your daily notes folder for heatmap tag counting.')
			.addText((text) =>
				text
					.setPlaceholder('_DailyNotes')
					.setValue(settings.dailyNotesFolder)
					.onChange(async (val) => {
						settings.dailyNotesFolder = val.trim() || '_DailyNotes';
						await this.save();
					}),
			);

		new Setting(el)
			.setName('Tag filter')
			.setDesc('Tag prefix to count in daily notes (without #).')
			.addText((text) =>
				text
					.setPlaceholder('Task')
					.setValue(settings.heatmapTagFilter)
					.onChange(async (val) => {
						settings.heatmapTagFilter = val.trim() || 'Task';
						await this.save();
					}),
			);

		new Setting(el)
			.setName('Heatmap color')
			.setDesc('Base color for the heatmap. Four intensity shades are auto-generated.')
			.addColorPicker((cp) =>
				cp.setValue(settings.heatmapColor).onChange(async (val) => {
					settings.heatmapColor = val;
					await this.save();
				}),
			);
	}

	private renderTaskTreeSection(el: HTMLElement): void {
		el.createEl('h2', { text: 'Task Tree' });

		const settings = this.plugin.data.settings;

		new Setting(el)
			.setName('Branch color')
			.setDesc('Base color for the task tree branches. Deeper subtasks use dimmer shades.')
			.addColorPicker((cp) =>
				cp.setValue(settings.branchColor).onChange(async (val) => {
					settings.branchColor = val;
					await this.save();
				}),
			);
	}

	private renderReportsSection(el: HTMLElement): void {
		el.createEl('h2', { text: 'Reports' });

		const settings = this.plugin.data.settings;

		new Setting(el)
			.setName('Report base folder')
			.setDesc('Vault path to the base folder containing report subfolders.')
			.addText((text) =>
				text
					.setPlaceholder('WorkspaceVault/Personal/ClaudeCRON')
					.setValue(settings.reportBasePath)
					.onChange(async (val) => {
						settings.reportBasePath = val.trim() || 'WorkspaceVault/Personal/ClaudeCRON';
						await this.save();
					}),
			);
	}

	private renderModulesSection(el: HTMLElement): void {
		el.createEl('h2', { text: 'Modules' });

		const settings = this.plugin.data.settings;

		for (const mod of settings.modules) {
			new Setting(el)
				.setName(mod.name)
				.addToggle((toggle) =>
					toggle.setValue(mod.enabled).onChange(async (val) => {
						mod.enabled = val;
						await this.save();
					}),
				);
		}
	}

	private renderDataSection(el: HTMLElement): void {
		el.createEl('h2', { text: 'Data' });

		const settings = this.plugin.data.settings;

		new Setting(el)
			.setName('Re-show onboarding')
			.setDesc('Reset the onboarding overlay so it appears on next dashboard open.')
			.addButton((btn) =>
				btn
					.setButtonText(settings.hasSeenOnboarding ? 'Reset' : 'Already showing')
					.setDisabled(settings.hasSeenOnboarding === false)
					.onClick(async () => {
						settings.hasSeenOnboarding = false;
						await this.save();
						this.display();
					}),
			);
	}

	private async save(): Promise<void> {
		await this.plugin.saveData(this.plugin.data);
		this.plugin.refreshWelcomeViews();
	}
}
