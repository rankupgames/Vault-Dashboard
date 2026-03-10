/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard Welcome
 * Description: Plugin settings tab for Obsidian Settings panel
 * Created: 2026-03-08
 * Last Modified: 2026-03-09
 */

import { App, PluginSettingTab, Setting } from 'obsidian';
import type VaultWelcomePlugin from './main';
import { DEFAULT_SETTINGS } from './core/types';

/** Plugin settings tab for Obsidian Settings panel. */
export class SettingsTab extends PluginSettingTab {
	private plugin: VaultWelcomePlugin;

	/**
	 * @param app - Obsidian app instance
	 * @param plugin - VaultWelcomePlugin instance
	 */
	constructor(app: App, plugin: VaultWelcomePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	/** @override */
	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		this.renderGeneralSection(containerEl);
		this.renderTimerSection(containerEl);
		this.renderAudioSection(containerEl);
		this.renderAISection(containerEl);
		this.renderTaskSection(containerEl);
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

		new Setting(el)
			.setName('Output folder')
			.setDesc('Base folder for all plugin-generated files (AI prompts, attachments, pasted documents). Subfolders are created per task.')
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.outputFolder)
					.setValue(settings.outputFolder)
					.onChange(async (val) => {
						settings.outputFolder = val.trim() || DEFAULT_SETTINGS.outputFolder;
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

	private renderAISection(el: HTMLElement): void {
		el.createEl('h2', { text: 'AI Integration' });

		const settings = this.plugin.data.settings;

		new Setting(el)
			.setName('AI tool')
			.setDesc('Select the CLI tool for AI dispatching. Set to "none" to disable all AI features.')
			.addDropdown((dd) =>
				dd
					.addOption('none', 'None (disabled)')
					.addOption('cursor', 'Cursor CLI')
					.addOption('claude-code', 'Claude Code CLI')
					.setValue(settings.aiTool)
					.onChange(async (val) => {
						settings.aiTool = val as 'cursor' | 'claude-code' | 'none';
						await this.save();
						this.display();
					}),
			);

		if (settings.aiTool !== 'none') {
			new Setting(el)
				.setName('Custom CLI path')
				.setDesc('Override the default CLI command path (leave empty for default).')
				.addText((text) =>
					text
						.setPlaceholder(settings.aiTool === 'cursor' ? 'cursor' : 'claude')
						.setValue(settings.aiToolPath)
						.onChange(async (val) => {
							settings.aiToolPath = val.trim();
							await this.save();
						}),
				);

			new Setting(el)
				.setName('Working directory')
				.setDesc('Directory where AI CLI commands execute. Leave blank to use the vault root.')
				.addText((text) =>
					text
						.setPlaceholder('/path/to/project')
						.setValue(settings.aiWorkingDirectory)
						.onChange(async (val) => {
							settings.aiWorkingDirectory = val.trim();
							await this.save();
						}),
				);

			new Setting(el)
				.setName('Skip permission prompts')
				.setDesc('Run AI CLI in non-interactive mode, bypassing confirmation dialogs.')
				.addToggle((toggle) =>
					toggle.setValue(settings.aiSkipPermissions).onChange(async (val) => {
						settings.aiSkipPermissions = val;
						await this.save();
					}),
				);

			new Setting(el)
				.setName('AI auto-organize')
				.setDesc('Show AI organize button in task modal to suggest tags and position.')
				.addToggle((toggle) =>
					toggle.setValue(settings.aiAutoOrganize).onChange(async (val) => {
						settings.aiAutoOrganize = val;
						await this.save();
					}),
				);

			new Setting(el)
				.setName('AI auto-order')
				.setDesc('Show AI sort button in timeline header to reorder pending tasks.')
				.addToggle((toggle) =>
					toggle.setValue(settings.aiAutoOrder).onChange(async (val) => {
						settings.aiAutoOrder = val;
						await this.save();
					}),
				);

			new Setting(el)
				.setName('AI auto-scheduler')
				.setDesc('Show AI schedule button to estimate task durations.')
				.addToggle((toggle) =>
					toggle.setValue(settings.aiAutoScheduler).onChange(async (val) => {
						settings.aiAutoScheduler = val;
						await this.save();
					}),
				);

			new Setting(el)
				.setName('AI delegation')
				.setDesc('Show delegate button on task rows to dispatch tasks to the AI tool.')
				.addToggle((toggle) =>
					toggle.setValue(settings.aiDelegation).onChange(async (val) => {
						settings.aiDelegation = val;
						await this.save();
					}),
				);

			new Setting(el)
				.setName('Terminal app')
				.setDesc('Terminal to open when taking over a dispatch.')
				.addDropdown((dd) =>
					dd
						.addOption('ghostty', 'Ghostty')
						.addOption('terminal', 'Terminal.app')
						.setValue(settings.terminalApp)
						.onChange(async (val) => {
							settings.terminalApp = val as 'ghostty' | 'terminal';
							await this.save();
						}),
				);
		}
	}

	private renderTaskSection(el: HTMLElement): void {
		el.createEl('h2', { text: 'Tasks' });

		const settings = this.plugin.data.settings;

		new Setting(el)
			.setName('Multi-tag filter')
			.setDesc('Allow selecting multiple tags in the timeline filter.')
			.addToggle((toggle) =>
				toggle.setValue(settings.enableMultiTagFilter).onChange(async (val) => {
					settings.enableMultiTagFilter = val;
					await this.save();
				}),
			);

		new Setting(el)
			.setName('Image attachments')
			.setDesc('Allow attaching images to tasks.')
			.addToggle((toggle) =>
				toggle.setValue(settings.enableImageAttachments).onChange(async (val) => {
					settings.enableImageAttachments = val;
					await this.save();
				}),
			);

		new Setting(el)
			.setName('Confirmation dialogs')
			.setDesc('Show confirmation dialogs before destructive actions.')
			.addToggle((toggle) =>
				toggle.setValue(settings.showConfirmDialogs).onChange(async (val) => {
					settings.showConfirmDialogs = val;
					await this.save();
				}),
			);

		new Setting(el)
			.setName('Auto-archive after N days')
			.setDesc('Automatically archive completed/skipped tasks after this many days. Set to 0 to disable.')
			.addText((text) =>
				text
					.setPlaceholder('0')
					.setValue(String(settings.autoArchiveDays))
					.onChange(async (val) => {
						const n = parseInt(val, 10);
						settings.autoArchiveDays = isNaN(n) || n < 0 ? 0 : n;
						await this.save();
					}),
			);
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

		el.createEl('h3', { text: 'Report Sources' });

		for (const src of settings.reportSources) {
			new Setting(el)
				.setName(src.label)
				.setDesc(`${src.frequency} -- ${src.folder}`)
				.addToggle((toggle) =>
					toggle.setValue(src.enabled).onChange(async (val) => {
						src.enabled = val;
						await this.save();
					}),
				);
		}

		new Setting(el)
			.setName('Add report source')
			.addButton((btn) =>
				btn.setButtonText('Add').onClick(async () => {
					settings.reportSources.push({
						id: `custom-${Date.now()}`,
						label: 'New Source',
						folder: 'FolderName',
						patternStr: '^(.+)\\.(md|html)$',
						frequency: 'daily',
						enabled: true,
					});
					await this.save();
					this.display();
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
