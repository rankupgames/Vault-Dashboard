import { describe, expect, it } from 'vitest';
import { createGmailReviewPrompt, GmailDigestCommandPaths } from '../../src/services/GmailDigestRunner';
import { DEFAULT_SETTINGS } from '../../src/core/types';

describe('createGmailReviewPrompt', () => {
	it('builds the Gmail review prompt from configured paths and query settings', () => {
		const paths: GmailDigestCommandPaths = {
			python: 'python3',
			script: 'Tools/gmail-vault-digest/gmail_vault_digest.py',
			workingDirectory: '/repo',
			vaultRoot: '/repo/Vault',
			outputRoot: '/repo/Vault/WorkspaceVault/Business/Operations/Gmail Intelligence',
		};

		const prompt = createGmailReviewPrompt(paths, DEFAULT_SETTINGS.gmailDigest);

		expect(prompt).toContain('--vault-root /repo/Vault');
		expect(prompt).toContain('--query \'in:anywhere newer_than:7d\'');
		expect(prompt).toContain('--limit 500');
		expect(prompt).toContain('--date today');
		expect(prompt).not.toContain(['', 'Users', 'dudetru25'].join('/'));
		expect(prompt).toContain('Do not send, delete, archive, label, or otherwise modify email.');
	});
});
