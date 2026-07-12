/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vaultboard
 * Description: Plugin settings tab for Obsidian Settings panel
 * Created: 2026-03-08
 * Last Modified: 2026-05-16
 */

import { Notice, PluginSettingTab, setIcon, Setting, type App } from 'obsidian';
import type VaultboardPlugin from './main';
import { AI_TOOL, type AIKeychainRef, type AIModelOption, type AITool, DEFAULT_SETTINGS } from './core/types';
import { AnalyticsExporter } from './services/AnalyticsExporter';
import { deleteKeychainSecret, hasKeychainSecret, setKeychainSecret } from './services/KeychainSecrets';

/** Plugin settings tab for Obsidian Settings panel. */
export class SettingsTab extends PluginSettingTab {
	/** Plugin instance used for settings persistence and dashboard refreshes. */
	private plugin: VaultboardPlugin;

	/**
	 * @param app - Obsidian app instance
	 * @param plugin - VaultboardPlugin instance
	 */
	constructor(app: App, plugin: VaultboardPlugin) {
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
		this.renderGmailIntelligenceSection(containerEl);
		this.renderTaskSection(containerEl);
		this.renderTagsSection(containerEl);
		this.renderTaskTreeSection(containerEl);
		this.renderHeatmapSection(containerEl);
		this.renderReportsSection(containerEl);
		this.renderCategorySection(containerEl);
		this.renderModulesSection(containerEl);
		this.renderExportSection(containerEl);
		this.renderDataSection(containerEl);
	}

	/** Renders auto-open, pin-tab, and output folder settings. */
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

	/** Renders timer mode dropdown and conditional clock-aligned / pomodoro sub-settings. */
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

	/** Renders audio enable toggle and per-event sound toggles. */
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

	/** Renders AI provider selection, API keys, models, permissions, and delegation settings. */
	private renderAISection(el: HTMLElement): void {
		el.createEl('h2', { text: 'AI Integration' });

		const settings = this.plugin.data.settings;
		const cursorSdkAvailable = this.plugin.aiDispatcher.isProviderAvailable(AI_TOOL.CURSOR_SDK);

		new Setting(el)
			.setName('AI tool')
			.setDesc('Select the provider for AI dispatching. Set to "none" to disable all AI features.')
			.addDropdown((dropdown) => {
				dropdown
					.addOption(AI_TOOL.NONE, 'None (disabled)')
					.addOption(AI_TOOL.CODEX_CLI, 'Codex CLI')
					.addOption(AI_TOOL.CLAUDE_CODE, 'Claude Code CLI')
					.addOption(AI_TOOL.OPENROUTER, 'OpenRouter');
				if (cursorSdkAvailable || settings.aiTool === AI_TOOL.CURSOR_SDK) {
					dropdown.addOption(AI_TOOL.CURSOR_SDK, cursorSdkAvailable ? 'Cursor SDK' : 'Cursor SDK (not installed)');
				}
				dropdown
					.setValue(settings.aiTool)
					.onChange(async (value) => {
						settings.aiTool = value as AITool;
						await this.save();
						this.display();
					});
			});

		if (settings.aiTool !== AI_TOOL.NONE) {
			this.renderSelectedAIProviderSettings(el, settings.aiTool);

			new Setting(el)
				.setName('Skip permission prompts')
				.setDesc('Allow the selected local AI tool to bypass confirmation dialogs for file and shell access.')
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

			new Setting(el)
				.setName('Post-dispatch IDE')
				.setDesc('Automatically open the workspace in this IDE after a dispatch completes.')
				.addDropdown((dd) =>
					dd
						.addOption('cursor', 'Cursor')
						.addOption('vscode', 'VS Code')
						.addOption('none', 'None')
						.setValue(settings.postDispatchIDE)
						.onChange(async (val) => {
							settings.postDispatchIDE = val as 'cursor' | 'vscode' | 'none';
							await this.save();
						}),
				);
		}
	}

	/** Renders settings for the currently selected AI provider. */
	private renderSelectedAIProviderSettings(el: HTMLElement, tool: AITool): void {
		const settings = this.plugin.data.settings;

		if (tool === AI_TOOL.CURSOR_SDK) {
			if (this.plugin.aiDispatcher.isProviderAvailable(AI_TOOL.CURSOR_SDK) === false) {
				new Setting(el)
					.setName('Cursor SDK unavailable')
					.setDesc('The @cursor/sdk package is not installed in this plugin folder. Install it locally or select Codex CLI, Claude Code, or OpenRouter.');
				return;
			}
			this.renderKeychainSecretSetting(
				el,
				'Cursor API key',
				settings.aiProviders.cursorSdk.apiKey,
				'Used by the Cursor Agent SDK. Stored in macOS Keychain.',
			);
			this.renderModelSetting(el, 'Cursor model', settings.aiProviders.cursorSdk.model, settings.aiProviders.cursorSdk.models, async (model) => {
				settings.aiProviders.cursorSdk.model = model;
				await this.save();
			}, 'composer-latest');
			this.renderModelRefreshSetting(el, 'Refresh Cursor models', async () => {
				const models = await this.plugin.aiDispatcher.refreshModels(settings);
				settings.aiProviders.cursorSdk.models = models;
				settings.aiProviders.cursorSdk.modelsUpdatedAt = Date.now();
				if (settings.aiProviders.cursorSdk.model.trim().length === 0 && models[0]) {
					settings.aiProviders.cursorSdk.model = models[0].id;
				}
				await this.save();
			});
		}

		if (tool === AI_TOOL.CODEX_CLI) {
			this.renderKeychainSecretSetting(
				el,
				'Codex API key',
				settings.aiProviders.codexCli.apiKey,
				'Optional override for Codex CLI. Stored as OPENAI_API_KEY when dispatching.',
			);
			this.renderCliPathSetting(el, 'Codex CLI path', 'codex', settings.aiProviders.codexCli.cliPath, async (path) => {
				settings.aiProviders.codexCli.cliPath = path;
				settings.aiToolPath = path;
				await this.save();
			});
			this.renderPlainModelSetting(el, 'Codex model', 'CLI default', settings.aiProviders.codexCli.model, async (model) => {
				settings.aiProviders.codexCli.model = model;
				await this.save();
			});
		}

		if (tool === AI_TOOL.CLAUDE_CODE) {
			this.renderKeychainSecretSetting(
				el,
				'Claude API key',
				settings.aiProviders.claudeCode.apiKey,
				'Optional override for Claude Code CLI. Stored as ANTHROPIC_API_KEY when dispatching.',
			);
			this.renderCliPathSetting(el, 'Claude Code path', 'claude', settings.aiProviders.claudeCode.cliPath, async (path) => {
				settings.aiProviders.claudeCode.cliPath = path;
				settings.aiToolPath = path;
				await this.save();
			});
			this.renderPlainModelSetting(el, 'Claude model', 'CLI default', settings.aiProviders.claudeCode.model, async (model) => {
				settings.aiProviders.claudeCode.model = model;
				await this.save();
			});
		}

		if (tool === AI_TOOL.OPENROUTER) {
			this.renderKeychainSecretSetting(
				el,
				'OpenRouter API key',
				settings.aiProviders.openRouter.apiKey,
				'Used for OpenRouter chat and model refresh requests. Stored in macOS Keychain.',
			);
			new Setting(el)
				.setName('OpenRouter base URL')
				.setDesc('API base URL for OpenRouter-compatible requests.')
				.addText((text) =>
					text
						.setPlaceholder('https://openrouter.ai/api/v1')
						.setValue(settings.aiProviders.openRouter.baseUrl)
						.onChange(async (value) => {
							settings.aiProviders.openRouter.baseUrl = value.trim() || 'https://openrouter.ai/api/v1';
							await this.save();
						}),
				);
			this.renderModelSetting(el, 'OpenRouter model', settings.aiProviders.openRouter.model, settings.aiProviders.openRouter.models, async (model) => {
				settings.aiProviders.openRouter.model = model;
				await this.save();
			}, 'Refresh models or paste a model id');
			this.renderModelRefreshSetting(el, 'Refresh OpenRouter models', async () => {
				const models = await this.plugin.aiDispatcher.refreshModels(settings);
				settings.aiProviders.openRouter.models = models;
				settings.aiProviders.openRouter.modelsUpdatedAt = Date.now();
				if (settings.aiProviders.openRouter.model.trim().length === 0 && models[0]) {
					settings.aiProviders.openRouter.model = models[0].id;
				}
				await this.save();
			});
		}
	}

	/** Renders a password input that saves, checks, and clears a Keychain-backed secret. */
	private renderKeychainSecretSetting(el: HTMLElement, label: string, ref: AIKeychainRef, desc: string): void {
		let pendingSecret = '';
		const setting = new Setting(el)
			.setName(label)
			.setDesc(`${desc} Keychain: ${ref.service} / ${ref.account}.`)
			.addText((text) => {
				text.inputEl.type = 'password';
				text
					.setPlaceholder('Paste API key')
					.onChange((value) => {
						pendingSecret = value.trim();
					});
			})
			.addButton((button) =>
				button
					.setIcon('save')
					.setTooltip('Save API key')
					.onClick(async () => {
						if (pendingSecret.length === 0) {
							new Notice('Paste an API key first.');
							return;
						}
						await setKeychainSecret(ref, pendingSecret);
						pendingSecret = '';
						new Notice(`${label} saved to Keychain.`);
						this.display();
					}),
			)
			.addButton((button) =>
				button
					.setIcon('trash-2')
					.setTooltip('Clear API key')
					.setWarning()
					.onClick(async () => {
						await deleteKeychainSecret(ref);
						new Notice(`${label} removed from Keychain.`);
						this.display();
					}),
			);

		void hasKeychainSecret(ref).then((hasSecret) => {
			setting.setDesc(`${desc} Status: ${hasSecret ? 'configured' : 'not configured'}. Keychain: ${ref.service} / ${ref.account}.`);
		});
	}

	/** Renders a provider model dropdown when a cached catalog exists, otherwise falls back to text input. */
	private renderModelSetting(
		el: HTMLElement,
		label: string,
		value: string,
		models: AIModelOption[],
		onChange: (model: string) => Promise<void>,
		placeholder: string,
	): void {
		if (models.length === 0) {
			this.renderPlainModelSetting(el, label, placeholder, value, onChange);
			return;
		}

		const options = this.sortedModels(models);
		new Setting(el)
			.setName(label)
			.setDesc('Select a cached model or refresh the provider model list.')
			.addDropdown((dropdown) => {
				if (value.trim().length > 0 && options.some((model) => model.id === value) === false) {
					dropdown.addOption(value, value);
				}
				for (const model of options) {
					dropdown.addOption(model.id, model.name === model.id ? model.id : `${model.name} (${model.id})`);
				}
				dropdown.setValue(value.trim() || (options[0]?.id ?? ''));
				dropdown.onChange(onChange);
			});
	}

	/** Renders a freeform model text field for providers without a cached catalog. */
	private renderPlainModelSetting(
		el: HTMLElement,
		label: string,
		placeholder: string,
		value: string,
		onChange: (model: string) => Promise<void>,
	): void {
		new Setting(el)
			.setName(label)
			.setDesc('Leave blank to use the provider default.')
			.addText((text) =>
				text
					.setPlaceholder(placeholder)
					.setValue(value)
					.onChange(async (model) => {
						await onChange(model.trim());
					}),
			);
	}

	/** Renders a refresh button that updates provider model catalogs using a saved API key. */
	private renderModelRefreshSetting(el: HTMLElement, label: string, refresh: () => Promise<void>): void {
		new Setting(el)
			.setName(label)
			.setDesc('Fetch available models for the selected provider using the saved API key.')
			.addButton((button) =>
				button
					.setIcon('refresh-cw')
					.setTooltip(label)
					.onClick(async () => {
						try {
							await refresh();
							new Notice('AI model list refreshed.');
							this.display();
						} catch (error) {
							new Notice(error instanceof Error ? error.message : 'Model refresh failed.');
						}
					}),
			);
	}

	/** Renders a CLI path override while allowing empty values to resolve through the login shell. */
	private renderCliPathSetting(
		el: HTMLElement,
		label: string,
		placeholder: string,
		value: string,
		onChange: (path: string) => Promise<void>,
	): void {
		new Setting(el)
			.setName(label)
			.setDesc('Override the CLI command path. Leave empty to resolve it from your login shell PATH.')
			.addText((text) =>
				text
					.setPlaceholder(placeholder)
					.setValue(value)
					.onChange(async (path) => {
						await onChange(path.trim());
					}),
			);
	}

	/** Sorts provider models by display name for stable dropdown rendering. */
	private sortedModels(models: AIModelOption[]): AIModelOption[] {
		return [...models].sort((a, b) => a.name.localeCompare(b.name));
	}

	/** Renders read-only Gmail digest command settings used by the dashboard buttons and prompts. */
	private renderGmailIntelligenceSection(el: HTMLElement): void {
		el.createEl('h2', { text: 'Gmail Intelligence' });

		const gmailSettings = this.plugin.data.settings.gmailDigest;

		new Setting(el)
			.setName('Python path')
			.setDesc('Leave blank to use the local gmail-vault-digest virtual environment.')
			.addText((text) =>
				text
					.setPlaceholder('~/.local/share/gmail-vault-digest/venv/bin/python3')
					.setValue(gmailSettings.pythonPath)
					.onChange(async (value) => {
						gmailSettings.pythonPath = value.trim();
						await this.save();
					}),
			);

		new Setting(el)
			.setName('Digest script path')
			.setDesc('Leave blank to resolve Tools/gmail-vault-digest/gmail_vault_digest.py next to the Vault repo.')
			.addText((text) =>
				text
					.setPlaceholder('<repo-root>/Tools/gmail-vault-digest/gmail_vault_digest.py')
					.setValue(gmailSettings.scriptPath)
					.onChange(async (value) => {
						gmailSettings.scriptPath = value.trim();
						await this.save();
					}),
			);

		new Setting(el)
			.setName('Working directory')
			.setDesc('Leave blank to use the repository folder next to the Vault.')
			.addText((text) =>
				text
					.setPlaceholder('<repo-root>')
					.setValue(gmailSettings.workingDirectory)
					.onChange(async (value) => {
						gmailSettings.workingDirectory = value.trim();
						await this.save();
					}),
			);

		new Setting(el)
			.setName('Default Gmail query')
			.setDesc('Read-only Gmail search query used for manual reviews and the 8 AM digest.')
			.addText((text) =>
				text
					.setPlaceholder('in:anywhere newer_than:7d')
					.setValue(gmailSettings.query)
					.onChange(async (value) => {
						gmailSettings.query = value.trim() || 'in:anywhere newer_than:7d';
						await this.save();
					}),
			);

		new Setting(el)
			.setName('Thread limit')
			.setDesc('Maximum Gmail threads to sync before generating an analysis digest.')
			.addText((text) =>
				text
					.setPlaceholder('500')
					.setValue(String(gmailSettings.limit))
					.onChange(async (value) => {
						const parsedLimit = parseInt(value, 10);
						gmailSettings.limit = Number.isNaN(parsedLimit) ? 500 : Math.max(1, Math.min(5000, parsedLimit));
						await this.save();
					}),
			);

		new Setting(el)
			.setName('Digest date')
			.setDesc('Use "today" for the local date, or provide YYYY-MM-DD for a specific digest.')
			.addText((text) =>
				text
					.setPlaceholder('today')
					.setValue(gmailSettings.digestDate)
					.onChange(async (value) => {
						gmailSettings.digestDate = value.trim() || 'today';
						await this.save();
					}),
			);

		new Setting(el)
			.setName('Credential safety')
			.setDesc('OAuth credentials, tokens, and sqlite state stay outside the Vault and repository. This module only lists generated analysis markdown.');
	}

	/** Renders task behavior settings: multi-tag filter, images, confirmations, auto-archive. */
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

	/** Renders tag management section: input bar at top, pills in a wrapped row below. */
	private renderTagsSection(el: HTMLElement): void {
		el.createEl('h2', { text: 'Tags' });

		const settings = this.plugin.data.settings;
		const taskTags = this.plugin.taskManager.getAllTags();
		const allTags = Array.from(new Set([...settings.customTags, ...taskTags])).sort();

		const inputRow = el.createDiv({ cls: 'vw-settings-tag-input-row' });
		const tagInput = inputRow.createEl('input', {
			cls: 'vw-settings-tag-input',
			attr: { type: 'text', placeholder: 'Add new tag (Enter to add)' },
		});

		tagInput.addEventListener('keydown', async (e: KeyboardEvent) => {
			if (e.key !== 'Enter') return;
			e.preventDefault();
			const val = tagInput.value.trim().toLowerCase();
			if (val === '' || allTags.includes(val)) return;
			settings.customTags.push(val);
			await this.save();
			this.display();
		});

		const pillWrap = el.createDiv({ cls: 'vw-settings-tag-pills' });

		for (const tag of allTags) {
			const color = settings.tagColors[tag];
			const pill = pillWrap.createDiv({ cls: 'vw-settings-tag-pill' });
			if (color) {
				pill.style.borderColor = color;
			}

			const dot = pill.createSpan({ cls: 'vw-settings-tag-dot' });
			dot.style.backgroundColor = color ?? '#888888';

			const hiddenPicker = pill.createEl('input', {
				cls: 'vw-settings-color-hidden',
				attr: { type: 'color', value: color ?? '#888888' },
			});
			dot.addEventListener('click', (e) => {
				e.stopPropagation();
				hiddenPicker.click();
			});
			hiddenPicker.addEventListener('input', async () => {
				const newColor = hiddenPicker.value;
				settings.tagColors[tag] = newColor;
				dot.style.backgroundColor = newColor;
				pill.style.borderColor = newColor;
				await this.save();
			});

			pill.createSpan({ cls: 'vw-settings-tag-name', text: tag });

			const xBtn = pill.createSpan({ cls: 'vw-settings-tag-x' });
			setIcon(xBtn, 'x');
			xBtn.addEventListener('click', async (e) => {
				e.stopPropagation();
				settings.customTags = settings.customTags.filter((t) => t !== tag);
				delete settings.tagColors[tag];
				this.plugin.taskManager.removeTagGlobally(tag);
				await this.save();
				this.display();
			});
		}
	}

	/** Renders heatmap settings: daily notes folder, tag filter, and base color picker. */
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

	/** Renders subtask tree settings: branch color picker. */
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

	/** Renders report base folder, per-source toggles, and "add source" button. */
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

	/** Renders category list with color pickers, rename fields, and delete buttons. */
	private renderCategorySection(el: HTMLElement): void {
		el.createEl('h2', { text: 'Task Categories' });

		const settings = this.plugin.data.settings;
		const sorted = [...settings.taskCategories].sort((a, b) => a.order - b.order);

		for (const cat of sorted) {
			const s = new Setting(el).setName(cat.name);

			if (cat.isDefault) s.setDesc(cat.dailyReset ? 'Default (daily reset)' : 'Default');

			s.addColorPicker((cp) =>
				cp.setValue(cat.color ?? '#888888').onChange(async (val) => {
					cat.color = val;
					await this.save();
				}),
			);

			if (cat.isDefault === false || cat.isDefault === undefined) {
				s.addText((text) =>
					text.setValue(cat.name).onChange(async (val) => {
						this.plugin.taskManager.renameCategory(cat.id, val.trim() || cat.name);
						await this.save();
					}),
				);

				s.addButton((btn) =>
					btn.setButtonText('Delete + Tasks').setWarning().onClick(async () => {
						this.plugin.taskManager.removeCategoryWithTasks(cat.id);
						await this.save();
						this.display();
					}),
				);
			}
		}

		new Setting(el)
			.setName('Add category')
			.addButton((btn) =>
				btn.setButtonText('Add').onClick(async () => {
					this.plugin.taskManager.addCategory('New Category');
					await this.save();
					this.display();
				}),
			);
	}

	/** Renders per-module enable/disable toggles. */
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

	/** Renders CSV export and daily note append buttons. */
	private renderExportSection(el: HTMLElement): void {
		el.createEl('h2', { text: 'Export' });

		new Setting(el)
			.setName('Export CSV')
			.setDesc('Download all tasks (active + archived) as a CSV file.')
			.addButton((btn) =>
				btn.setButtonText('Export').onClick(() => {
					const csv = AnalyticsExporter.exportToCSV(
						this.plugin.taskManager.toJSON(),
						this.plugin.taskManager.getArchivedTasks(),
					);
					AnalyticsExporter.downloadCSV(csv, 'vaultboard-tasks.csv');
					new Notice('CSV exported');
				}),
			);

		new Setting(el)
			.setName('Append to Daily Note')
			.setDesc('Append today\'s task summary to the daily note.')
			.addButton((btn) =>
				btn.setButtonText('Append').onClick(async () => {
					await AnalyticsExporter.exportToDailyNote(
						this.app,
						this.plugin.taskManager.toJSON(),
						this.plugin.data.settings.dailyNotesFolder,
					);
					new Notice('Appended to daily note');
				}),
			);
	}

	/** Renders data management section with welcome guide reset. */
	private renderDataSection(el: HTMLElement): void {
		el.createEl('h2', { text: 'Data' });

		const settings = this.plugin.data.settings;

		new Setting(el)
			.setName('Re-show welcome guide')
			.setDesc('Reset so the welcome modal appears on next dashboard open.')
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

	/** Persists plugin data and refreshes all open dashboard views. */
	private async save(): Promise<void> {
		await this.plugin.saveData(this.plugin.data);
		this.plugin.refreshWelcomeViews();
	}
}
