/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard
 * Description: Shared vault filesystem utilities used by modals and services
 * Created: 2026-03-10
 * Last Modified: 2026-03-10
 */

import { App } from 'obsidian';

/** Creates nested vault folders if they don't already exist. */
export const ensureVaultFolder = async (app: App, folderPath: string): Promise<void> => {
	const parts = folderPath.split('/').filter(Boolean);
	let current = '';
	for (const part of parts) {
		current = current ? `${current}/${part}` : part;
		if (app.vault.getAbstractFileByPath(current) === null) {
			await app.vault.createFolder(current);
		}
	}
};
