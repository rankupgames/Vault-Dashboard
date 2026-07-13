/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vaultboard
 * Description: Shared dependencies supplied to focused settings section renderers
 * Created: 2026-07-12
 */

import type { App } from 'obsidian';
import type VaultboardPlugin from '../main';

/** Shared settings rendering boundary that keeps section modules independent from SettingsTab. */
export interface SettingsSectionContext {
	/** Obsidian application used by settings actions that read or write Vault data. */
	app: App;
	/** Active plugin instance that owns settings and runtime services. */
	plugin: VaultboardPlugin;
	/** Persists plugin data and refreshes open dashboard views. */
	save: () => Promise<void>;
	/** Rebuilds the settings panel after conditional controls change. */
	redisplay: () => void;
}
