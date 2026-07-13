/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vaultboard
 * Description: Obsidian settings tab orchestrator for focused settings section renderers
 * Created: 2026-03-08
 * Last Modified: 2026-07-12
 */

import { PluginSettingTab, type App } from 'obsidian';
import type VaultboardPlugin from './main';
import { renderAISettings } from './settings/AISettingsSection';
import {
	renderCategorySettings,
	renderHeatmapSettings,
	renderModuleSettings,
	renderReportSettings,
	renderTaskTreeSettings,
} from './settings/DashboardSettingsSection';
import {
	renderDataSettings,
	renderExportSettings,
} from './settings/DataSettingsSection';
import {
	renderAudioSettings,
	renderGeneralSettings,
	renderTimerSettings,
} from './settings/GeneralSettingsSection';
import { renderGmailSettings } from './settings/GmailSettingsSection';
import type { SettingsSectionContext } from './settings/SettingsSectionContext';
import {
	renderTagSettings,
	renderTaskSettings,
} from './settings/TaskSettingsSection';

/** Composes focused settings section renderers inside Obsidian's plugin settings surface. */
export class SettingsTab extends PluginSettingTab {
	/** Plugin instance used to build section dependencies and persist changes. */
	private plugin: VaultboardPlugin;

	/** Creates the settings tab around the active Vaultboard plugin instance. */
	constructor(app: App, plugin: VaultboardPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	/** Rebuilds all settings sections in their established display order. */
	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const context = this.createSectionContext();

		renderGeneralSettings(containerEl, context);
		renderTimerSettings(containerEl, context);
		renderAudioSettings(containerEl, context);
		renderAISettings(containerEl, context);
		renderGmailSettings(containerEl, context);
		renderTaskSettings(containerEl, context);
		renderTagSettings(containerEl, context);
		renderTaskTreeSettings(containerEl, context);
		renderHeatmapSettings(containerEl, context);
		renderReportSettings(containerEl, context);
		renderCategorySettings(containerEl, context);
		renderModuleSettings(containerEl, context);
		renderExportSettings(containerEl, context);
		renderDataSettings(containerEl, context);
	}

	/** Creates bound callbacks so extracted sections cannot lose the active tab instance. */
	private createSectionContext(): SettingsSectionContext {
		return {
			app: this.app,
			plugin: this.plugin,
			save: () => this.save(),
			redisplay: () => this.display(),
		};
	}

	/** Persists plugin data and refreshes all open dashboard views after any setting mutation. */
	private async save(): Promise<void> {
		await this.plugin.saveData(this.plugin.data);
		this.plugin.refreshWelcomeViews();
	}
}
