/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vaultboard
 * Description: Vault-side JSON backup for plugin data protection across updates
 * Created: 2026-03-13
 * Last Modified: 2026-03-13
 */

import { App, normalizePath } from 'obsidian';
import type { PluginData } from '../core/types';

const BACKUP_FILENAME = 'vaultboard-backup.json';
const LEGACY_BACKUP_PATH = '_VaultDashboard/vault-dashboard-backup.json';

/** Vault-side JSON backup that survives plugin reinstalls and updates. */
export class BackupService {
	/** Writes plugin data as JSON to a vault-side backup file. */
	static async write(app: App, outputFolder: string, data: PluginData): Promise<void> {
		const path = normalizePath(`${outputFolder}/${BACKUP_FILENAME}`);
		const json = JSON.stringify(data, null, 2);

		const dir = path.substring(0, path.lastIndexOf('/'));
		if (dir && app.vault.getAbstractFileByPath(dir) === null) {
			const exists = await app.vault.adapter.exists(dir);
			if (exists === false) await app.vault.createFolder(dir);
		}

		await app.vault.adapter.write(path, json);
	}

	/** Attempts to restore plugin data from the current backup, then migrates the pre-rename backup when needed. */
	static async restore(app: App, outputFolder: string): Promise<PluginData | null> {
		const path = normalizePath(`${outputFolder}/${BACKUP_FILENAME}`);
		const exists = await app.vault.adapter.exists(path);
		if (exists) return this.read(app, path);

		const legacyExists = await app.vault.adapter.exists(LEGACY_BACKUP_PATH);
		if (legacyExists === false) return null;
		return this.read(app, LEGACY_BACKUP_PATH);
	}

	/** Reads and validates a backup file that is known to exist. */
	private static async read(app: App, path: string): Promise<PluginData | null> {
		const raw = await app.vault.adapter.read(path);
		if (raw === '' || raw === undefined) return null;

		const parsed = JSON.parse(raw);
		if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
		return parsed as PluginData;
	}
}
