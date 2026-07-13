/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vaultboard
 * Description: AI provider, credential, model, and dispatch settings renderer
 * Created: 2026-07-12
 */

import { Notice, Setting } from 'obsidian';
import {
	AI_TOOL,
	type AIKeychainRef,
	type AIModelOption,
	type AITool,
} from '../core/types';
import {
	deleteKeychainSecret,
	hasKeychainSecret,
	setKeychainSecret,
} from '../services/KeychainSecrets';
import type { SettingsSectionContext } from './SettingsSectionContext';

/** Renders provider selection, credentials, models, safety controls, and dispatch behavior. */
export const renderAISettings = (element: HTMLElement, context: SettingsSectionContext): void => {
	element.createEl('h2', { text: 'AI Integration' });
	const settings = context.plugin.data.settings;
	const cursorSdkAvailable = context.plugin.aiDispatcher.isProviderAvailable(AI_TOOL.CURSOR_SDK);

	new Setting(element)
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
					await context.save();
					context.redisplay();
				});
		});

	renderAITaskListSetting(
		element,
		'Task session skills',
		'Optional skill names included in interactive Codex CLI or Claude Code task prompts. One per line or comma-separated. This does not install or enable skills.',
		settings.aiTaskSkills,
		async (values) => {
			settings.aiTaskSkills = values;
			await context.save();
		},
	);
	renderAITaskListSetting(
		element,
		'Task session tools',
		'Optional tool names included in interactive Codex CLI or Claude Code task prompts. One per line or comma-separated. This does not grant permissions or guarantee provider support.',
		settings.aiTaskTools,
		async (values) => {
			settings.aiTaskTools = values;
			await context.save();
		},
	);

	if (settings.aiTool === AI_TOOL.NONE) return;

	renderSelectedAIProviderSettings(element, context, settings.aiTool);

	new Setting(element)
		.setName('Bypass local provider safeguards')
		.setDesc('Dangerously remove the Codex sandbox or pass Claude Code skip-permission flags. Codex dispatches are always non-interactive; leave this disabled to preserve its read-only/workspace-write sandbox.')
		.addToggle((toggle) =>
			toggle.setValue(settings.aiSkipPermissions).onChange(async (value) => {
				settings.aiSkipPermissions = value;
				await context.save();
			}),
		);

	new Setting(element)
		.setName('AI auto-organize')
		.setDesc('Show AI organize button in task modal to suggest tags and position.')
		.addToggle((toggle) =>
			toggle.setValue(settings.aiAutoOrganize).onChange(async (value) => {
				settings.aiAutoOrganize = value;
				await context.save();
			}),
		);

	new Setting(element)
		.setName('AI auto-order')
		.setDesc('Show AI sort button in timeline header to reorder pending tasks.')
		.addToggle((toggle) =>
			toggle.setValue(settings.aiAutoOrder).onChange(async (value) => {
				settings.aiAutoOrder = value;
				await context.save();
			}),
		);

	new Setting(element)
		.setName('AI delegation')
		.setDesc('Show delegate button on task rows to dispatch tasks to the AI tool.')
		.addToggle((toggle) =>
			toggle.setValue(settings.aiDelegation).onChange(async (value) => {
				settings.aiDelegation = value;
				await context.save();
			}),
		);

	new Setting(element)
		.setName('Terminal app')
		.setDesc('Terminal to open when taking over a dispatch.')
		.addDropdown((dropdown) =>
			dropdown
				.addOption('ghostty', 'Ghostty')
				.addOption('terminal', 'Terminal.app')
				.setValue(settings.terminalApp)
				.onChange(async (value) => {
					settings.terminalApp = value as 'ghostty' | 'terminal';
					await context.save();
				}),
		);

	new Setting(element)
		.setName('Post-dispatch IDE')
		.setDesc('Automatically open the workspace in this IDE after a dispatch completes.')
		.addDropdown((dropdown) =>
			dropdown
				.addOption('cursor', 'Cursor')
				.addOption('vscode', 'VS Code')
				.addOption('none', 'None')
				.setValue(settings.postDispatchIDE)
				.onChange(async (value) => {
					settings.postDispatchIDE = value as 'cursor' | 'vscode' | 'none';
					await context.save();
				}),
		);
};

/** Parses comma/newline-separated setting values while preserving first occurrence order. */
export const parseAITaskList = (value: string): string[] => {
	const values: string[] = [];
	const seen = new Set<string>();
	for (const item of value.split(/[\n,]+/)) {
		const normalized = item.trim();
		if (normalized.length === 0 || seen.has(normalized)) continue;
		seen.add(normalized);
		values.push(normalized);
	}
	return values;
};

/** Renders a transparent freeform list without claiming to install or authorize capabilities. */
const renderAITaskListSetting = (
	element: HTMLElement,
	label: string,
	description: string,
	values: string[],
	onChange: (values: string[]) => Promise<void>,
): void => {
	new Setting(element)
		.setName(label)
		.setDesc(description)
		.addTextArea((textArea) => {
			textArea.inputEl.rows = 3;
			textArea
				.setPlaceholder('One name per line or comma-separated')
				.setValue(values.join('\n'))
				.onChange(async (value) => {
					await onChange(parseAITaskList(value));
				});
		});
};

/** Renders controls owned by the selected provider without leaking provider logic into the tab. */
const renderSelectedAIProviderSettings = (
	element: HTMLElement,
	context: SettingsSectionContext,
	tool: AITool,
): void => {
	const settings = context.plugin.data.settings;

	if (tool === AI_TOOL.CURSOR_SDK) {
		if (context.plugin.aiDispatcher.isProviderAvailable(AI_TOOL.CURSOR_SDK) === false) {
			new Setting(element)
				.setName('Cursor SDK unavailable')
				.setDesc('The @cursor/sdk package is not installed in this plugin folder. Install it locally or select Codex CLI, Claude Code, or OpenRouter.');
			return;
		}
		renderKeychainSecretSetting(
			element,
			context,
			'Cursor API key',
			settings.aiProviders.cursorSdk.apiKey,
			'Used by the Cursor Agent SDK. Stored in macOS Keychain.',
		);
		renderModelSetting(
			element,
			'Cursor model',
			settings.aiProviders.cursorSdk.model,
			settings.aiProviders.cursorSdk.models,
			async (model) => {
				settings.aiProviders.cursorSdk.model = model;
				await context.save();
			},
			'composer-latest',
		);
		renderModelRefreshSetting(element, context, 'Refresh Cursor models', async () => {
			const models = await context.plugin.aiDispatcher.refreshModels(settings);
			settings.aiProviders.cursorSdk.models = models;
			settings.aiProviders.cursorSdk.modelsUpdatedAt = Date.now();
			if (settings.aiProviders.cursorSdk.model.trim().length === 0 && models[0]) {
				settings.aiProviders.cursorSdk.model = models[0].id;
			}
			await context.save();
		});
	}

	if (tool === AI_TOOL.CODEX_CLI) {
		renderKeychainSecretSetting(
			element,
			context,
			'Codex API key',
			settings.aiProviders.codexCli.apiKey,
			'Optional override for Codex CLI. Stored as OPENAI_API_KEY when dispatching.',
		);
		renderCliPathSetting(element, 'Codex CLI path', 'codex', settings.aiProviders.codexCli.cliPath, async (path) => {
			settings.aiProviders.codexCli.cliPath = path;
			settings.aiToolPath = path;
			await context.save();
		});
		renderPlainModelSetting(element, 'Codex model', 'CLI default', settings.aiProviders.codexCli.model, async (model) => {
			settings.aiProviders.codexCli.model = model;
			await context.save();
		});
	}

	if (tool === AI_TOOL.CLAUDE_CODE) {
		renderKeychainSecretSetting(
			element,
			context,
			'Claude API key',
			settings.aiProviders.claudeCode.apiKey,
			'Optional override for Claude Code CLI. Stored as ANTHROPIC_API_KEY when dispatching.',
		);
		renderCliPathSetting(element, 'Claude Code path', 'claude', settings.aiProviders.claudeCode.cliPath, async (path) => {
			settings.aiProviders.claudeCode.cliPath = path;
			settings.aiToolPath = path;
			await context.save();
		});
		renderPlainModelSetting(element, 'Claude model', 'CLI default', settings.aiProviders.claudeCode.model, async (model) => {
			settings.aiProviders.claudeCode.model = model;
			await context.save();
		});
	}

	if (tool === AI_TOOL.OPENROUTER) {
		renderKeychainSecretSetting(
			element,
			context,
			'OpenRouter API key',
			settings.aiProviders.openRouter.apiKey,
			'Used for OpenRouter chat and model refresh requests. Stored in macOS Keychain.',
		);
		new Setting(element)
			.setName('OpenRouter base URL')
			.setDesc('API base URL for OpenRouter-compatible requests.')
			.addText((text) =>
				text
					.setPlaceholder('https://openrouter.ai/api/v1')
					.setValue(settings.aiProviders.openRouter.baseUrl)
					.onChange(async (value) => {
						settings.aiProviders.openRouter.baseUrl = value.trim() || 'https://openrouter.ai/api/v1';
						await context.save();
					}),
			);
		renderModelSetting(
			element,
			'OpenRouter model',
			settings.aiProviders.openRouter.model,
			settings.aiProviders.openRouter.models,
			async (model) => {
				settings.aiProviders.openRouter.model = model;
				await context.save();
			},
			'Refresh models or paste a model id',
		);
		renderModelRefreshSetting(element, context, 'Refresh OpenRouter models', async () => {
			const models = await context.plugin.aiDispatcher.refreshModels(settings);
			settings.aiProviders.openRouter.models = models;
			settings.aiProviders.openRouter.modelsUpdatedAt = Date.now();
			if (settings.aiProviders.openRouter.model.trim().length === 0 && models[0]) {
				settings.aiProviders.openRouter.model = models[0].id;
			}
			await context.save();
		});
	}
};

/** Renders Keychain save, status, and clear actions without persisting secret values in plugin data. */
const renderKeychainSecretSetting = (
	element: HTMLElement,
	context: SettingsSectionContext,
	label: string,
	reference: AIKeychainRef,
	description: string,
): void => {
	let pendingSecret = '';
	const setting = new Setting(element)
		.setName(label)
		.setDesc(`${description} Keychain: ${reference.service} / ${reference.account}.`)
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
					await setKeychainSecret(reference, pendingSecret);
					pendingSecret = '';
					new Notice(`${label} saved to Keychain.`);
					context.redisplay();
				}),
		)
		.addButton((button) =>
			button
				.setIcon('trash-2')
				.setTooltip('Clear API key')
				.setWarning()
				.onClick(async () => {
					await deleteKeychainSecret(reference);
					new Notice(`${label} removed from Keychain.`);
					context.redisplay();
				}),
		);

	void hasKeychainSecret(reference).then((hasSecret) => {
		setting.setDesc(`${description} Status: ${hasSecret ? 'configured' : 'not configured'}. Keychain: ${reference.service} / ${reference.account}.`);
	});
};

/** Renders a cached model dropdown or delegates to freeform input when no catalog exists. */
const renderModelSetting = (
	element: HTMLElement,
	label: string,
	value: string,
	models: AIModelOption[],
	onChange: (model: string) => Promise<void>,
	placeholder: string,
): void => {
	if (models.length === 0) {
		renderPlainModelSetting(element, label, placeholder, value, onChange);
		return;
	}

	const options = sortedModels(models);
	new Setting(element)
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
};

/** Renders a freeform model override while preserving provider defaults for blank values. */
const renderPlainModelSetting = (
	element: HTMLElement,
	label: string,
	placeholder: string,
	value: string,
	onChange: (model: string) => Promise<void>,
): void => {
	new Setting(element)
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
};

/** Renders model catalog refresh feedback while preserving existing provider error text. */
const renderModelRefreshSetting = (
	element: HTMLElement,
	context: SettingsSectionContext,
	label: string,
	refresh: () => Promise<void>,
): void => {
	new Setting(element)
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
						context.redisplay();
					} catch (error) {
						new Notice(error instanceof Error ? error.message : 'Model refresh failed.');
					}
				}),
		);
};

/** Renders a CLI path override that falls back to login-shell resolution when blank. */
const renderCliPathSetting = (
	element: HTMLElement,
	label: string,
	placeholder: string,
	value: string,
	onChange: (path: string) => Promise<void>,
): void => {
	new Setting(element)
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
};

/** Returns a stable display-name ordering for cached provider model catalogs. */
const sortedModels = (models: AIModelOption[]): AIModelOption[] =>
	[...models].sort((first, second) => first.name.localeCompare(second.name));
