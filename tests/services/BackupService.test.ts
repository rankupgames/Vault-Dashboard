/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vaultboard
 * Description: Tests backup restore behavior across the Vaultboard identity migration
 * Created: 2026-07-12
 * Last Modified: 2026-07-12
 */

import { describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import { BackupService } from '../../src/services/BackupService';

/** Creates the minimal Obsidian app surface required by BackupService. */
const createApp = (exists: (path: string) => boolean, backupJson: string): App => ({
	vault: {
		adapter: {
			exists: vi.fn(async (path: string) => exists(path)),
			read: vi.fn(async () => backupJson),
		},
	},
}) as unknown as App;

describe('BackupService identity migration', () => {
	it('restores the current Vaultboard backup when it exists', async () => {
		const app = createApp(
			(path) => path === '_Vaultboard/vaultboard-backup.json',
			JSON.stringify({ tasks: [{ id: 'current' }] }),
		);

		const restored = await BackupService.restore(app, '_Vaultboard');

		expect(restored?.tasks).toEqual([{ id: 'current' }]);
		expect(app.vault.adapter.read).toHaveBeenCalledWith('_Vaultboard/vaultboard-backup.json');
	});

	it('restores the pre-rename backup when no Vaultboard backup exists', async () => {
		const app = createApp(
			(path) => path === '_VaultDashboard/vault-dashboard-backup.json',
			JSON.stringify({ tasks: [{ id: 'legacy' }] }),
		);

		const restored = await BackupService.restore(app, '_Vaultboard');

		expect(restored?.tasks).toEqual([{ id: 'legacy' }]);
		expect(app.vault.adapter.read).toHaveBeenCalledWith('_VaultDashboard/vault-dashboard-backup.json');
	});
});
