/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard Welcome
 * Description: Vault-side JSON backup for plugin data protection across updates
 * Created: 2026-03-13
 * Last Modified: 2026-03-13
 */

import { App, normalizePath } from 'obsidian';
import type { PluginData } from '../core/types';

const BACKUP_FILENAME = 'vault-dashboard-backup.json';

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

	/** Attempts to restore plugin data from the vault-side backup. Returns null if unavailable. */
	static async restore(app: App, outputFolder: string): Promise<PluginData | null> {
		const path = normalizePath(`${outputFolder}/${BACKUP_FILENAME}`);

		const exists = await app.vault.adapter.exists(path);
		if (exists === false) return null;

		const raw = await app.vault.adapter.read(path);
		if (raw === '' || raw === undefined) return null;

		const parsed = JSON.parse(raw);
		if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
		return parsed as PluginData;
	}
}
