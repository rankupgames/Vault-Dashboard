/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard
 * Description: Module-level tracker that closes all open modals on plugin unload
 * Created: 2026-03-17
 * Last Modified: 2026-03-17
 */

import { Modal } from 'obsidian';

const openModals = new Set<Modal>();

/** Adds a modal to the active set. Call from onOpen(). */
export const registerModal = (modal: Modal): void => {
	openModals.add(modal);
};

/** Removes a modal from the active set. Call from onClose(). */
export const unregisterModal = (modal: Modal): void => {
	openModals.delete(modal);
};

/** Force-closes every tracked modal. Called from plugin onunload(). */
export const closeAllModals = (): void => {
	for (const m of [...openModals]) {
		m.close();
	}
	openModals.clear();
};
