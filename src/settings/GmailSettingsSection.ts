/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vaultboard
 * Description: Gmail intelligence command settings renderer
 * Created: 2026-07-12
 */

import { Setting } from 'obsidian';
import type { SettingsSectionContext } from './SettingsSectionContext';

/** Renders read-only Gmail digest command settings used by dashboard actions. */
export const renderGmailSettings = (element: HTMLElement, context: SettingsSectionContext): void => {
	element.createEl('h2', { text: 'Gmail Intelligence' });
	const gmailSettings = context.plugin.data.settings.gmailDigest;

	new Setting(element)
		.setName('Python path')
		.setDesc('Leave blank to use the local gmail-vault-digest virtual environment.')
		.addText((text) =>
			text
				.setPlaceholder('~/.local/share/gmail-vault-digest/venv/bin/python3')
				.setValue(gmailSettings.pythonPath)
				.onChange(async (value) => {
					gmailSettings.pythonPath = value.trim();
					await context.save();
				}),
		);

	new Setting(element)
		.setName('Digest script path')
		.setDesc('Leave blank to resolve Tools/gmail-vault-digest/gmail_vault_digest.py next to the Vault repo.')
		.addText((text) =>
			text
				.setPlaceholder('<repo-root>/Tools/gmail-vault-digest/gmail_vault_digest.py')
				.setValue(gmailSettings.scriptPath)
				.onChange(async (value) => {
					gmailSettings.scriptPath = value.trim();
					await context.save();
				}),
		);

	new Setting(element)
		.setName('Working directory')
		.setDesc('Leave blank to use the repository folder next to the Vault.')
		.addText((text) =>
			text
				.setPlaceholder('<repo-root>')
				.setValue(gmailSettings.workingDirectory)
				.onChange(async (value) => {
					gmailSettings.workingDirectory = value.trim();
					await context.save();
				}),
		);

	new Setting(element)
		.setName('Default Gmail query')
		.setDesc('Read-only Gmail search query used for manual reviews and the 8 AM digest.')
		.addText((text) =>
			text
				.setPlaceholder('in:anywhere newer_than:7d')
				.setValue(gmailSettings.query)
				.onChange(async (value) => {
					gmailSettings.query = value.trim() || 'in:anywhere newer_than:7d';
					await context.save();
				}),
		);

	new Setting(element)
		.setName('Thread limit')
		.setDesc('Maximum Gmail threads to sync before generating an analysis digest.')
		.addText((text) =>
			text
				.setPlaceholder('500')
				.setValue(String(gmailSettings.limit))
				.onChange(async (value) => {
					const parsedLimit = parseInt(value, 10);
					gmailSettings.limit = Number.isNaN(parsedLimit)
						? 500
						: Math.max(1, Math.min(5000, parsedLimit));
					await context.save();
				}),
		);

	new Setting(element)
		.setName('Digest date')
		.setDesc('Use "today" for the local date, or provide YYYY-MM-DD for a specific digest.')
		.addText((text) =>
			text
				.setPlaceholder('today')
				.setValue(gmailSettings.digestDate)
				.onChange(async (value) => {
					gmailSettings.digestDate = value.trim() || 'today';
					await context.save();
				}),
		);

	new Setting(element)
		.setName('Credential safety')
		.setDesc('OAuth credentials, tokens, and sqlite state stay outside the Vault and repository. This module only lists generated analysis markdown.');
};
