/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard
 * Description: macOS Keychain helpers for plugin-managed AI API keys
 * Created: 2026-05-14
 * Last Modified: 2026-05-16
 */

import type { AIKeychainRef } from '../core/types';

/** macOS command-line utility used for Keychain reads and writes. */
const SECURITY_COMMAND = 'security';

/** Returns true when Obsidian is running with Node APIs available. */
const isDesktopNodeRuntime = (): boolean =>
	typeof process !== 'undefined' && process.versions?.node !== undefined && typeof require === 'function';

/** Validates Keychain coordinates before they are passed to the macOS security command. */
const assertValidKeychainRef = (ref: AIKeychainRef): void => {
	if (ref.service.trim().length === 0 || ref.account.trim().length === 0) {
		throw new Error('Keychain service and account are required.');
	}
};

/** Runs the macOS security command without invoking a shell. */
const runSecurity = (args: string[]): Promise<string> => {
	if (isDesktopNodeRuntime() === false) {
		return Promise.reject(new Error('Keychain access is only available in Obsidian desktop.'));
	}

	return new Promise((resolve, reject) => {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const { spawn } = require('child_process') as typeof import('child_process');
		const child = spawn(SECURITY_COMMAND, args, { stdio: ['ignore', 'pipe', 'pipe'] });
		const standardOutputChunks: Buffer[] = [];
		const standardErrorChunks: Buffer[] = [];
		child.stdout.on('data', (chunk: Buffer) => standardOutputChunks.push(chunk));
		child.stderr.on('data', (chunk: Buffer) => standardErrorChunks.push(chunk));
		child.on('error', (error: Error) => reject(error));
		child.on('close', (code: number | null) => {
			const standardOutput = Buffer.concat(standardOutputChunks).toString('utf-8');
			const standardError = Buffer.concat(standardErrorChunks).toString('utf-8');
			if (code === 0) {
				resolve(standardOutput);
				return;
			}
			reject(new Error(standardError.trim() || `security exited with code ${code ?? 'unknown'}`));
		});
	});
};

/** Stores or replaces a provider API key in macOS Keychain without writing it to plugin data. */
export const setKeychainSecret = async (ref: AIKeychainRef, value: string): Promise<void> => {
	assertValidKeychainRef(ref);
	const secret = value.trim();
	if (secret.length === 0) {
		throw new Error('API key cannot be empty.');
	}
	await runSecurity(['add-generic-password', '-U', '-s', ref.service, '-a', ref.account, '-w', secret]);
};

/** Reads a provider API key from macOS Keychain, returning undefined when the item is absent. */
export const getKeychainSecret = async (ref: AIKeychainRef): Promise<string | undefined> => {
	assertValidKeychainRef(ref);
	try {
		const stdout = await runSecurity(['find-generic-password', '-s', ref.service, '-a', ref.account, '-w']);
		const secret = stdout.trim();
		return secret.length > 0 ? secret : undefined;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (message.includes('could not be found') || message.includes('specified item could not be found')) {
			return undefined;
		}
		throw error;
	}
};

/** Checks for a Keychain item without reading the secret value. */
export const hasKeychainSecret = async (ref: AIKeychainRef): Promise<boolean> => {
	assertValidKeychainRef(ref);
	try {
		await runSecurity(['find-generic-password', '-s', ref.service, '-a', ref.account]);
		return true;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (message.includes('could not be found') || message.includes('specified item could not be found')) {
			return false;
		}
		throw error;
	}
};

/** Deletes a provider API key from macOS Keychain, treating missing items as already removed. */
export const deleteKeychainSecret = async (ref: AIKeychainRef): Promise<void> => {
	assertValidKeychainRef(ref);
	try {
		await runSecurity(['delete-generic-password', '-s', ref.service, '-a', ref.account]);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (message.includes('could not be found') || message.includes('specified item could not be found')) {
			return;
		}
		throw error;
	}
};
