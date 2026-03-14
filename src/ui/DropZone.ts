/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard Welcome
 * Description: Composable drop zone for drag-and-drop files and clipboard paste (images, docs, text)
 * Created: 2026-03-09
 * Last Modified: 2026-03-09
 */

import { setIcon } from 'obsidian';

/** Accepted content types for a drop zone instance. */
export interface DropZoneAccept {
	/** File extensions to accept on drag-drop (e.g. ['png','jpg']). */
	extensions?: string[];
	/** MIME type prefixes for clipboard items (e.g. ['image/']). */
	mimeTypes?: string[];
	/** Whether to accept plain-text paste. */
	text?: boolean;
}

/** Callbacks fired when content is received via drop or paste. */
export interface DropZoneCallbacks {
	/** External files dragged from the OS. */
	onExternalFiles?: (files: File[]) => void | Promise<void>;
	/** Vault-relative paths dragged from Obsidian's sidebar. */
	onVaultPaths?: (paths: string[]) => void;
	/** Blob pasted from clipboard (e.g. screenshot). */
	onBlob?: (blob: Blob, mimeType: string) => void | Promise<void>;
	/** Plain text pasted from clipboard. */
	onText?: (text: string) => void | Promise<void>;
}

/** Configuration passed when creating a DropZone. */
export interface DropZoneConfig {
	accept: DropZoneAccept;
	callbacks: DropZoneCallbacks;
	label?: string;
	icon?: string;
}

/**
 * Composable drop zone that handles drag-and-drop and clipboard paste.
 * Attach to any container for drag events; call `bindPaste` for clipboard support.
 */
export class DropZone {
	private zoneEl: HTMLElement;
	private config: DropZoneConfig;
	private pasteScope: HTMLElement | null = null;
	private pasteHandler: ((e: ClipboardEvent) => void) | null = null;
	private dragCounter = 0;

	/** Creates a drop zone bound to the parent with the given config. */
	constructor(parent: HTMLElement, config: DropZoneConfig) {
		this.config = config;
		this.zoneEl = this.buildZone(parent);
		this.attachDragListeners();
		this.attachClickToPaste();
	}

	/** Attaches a clipboard paste listener to `scope` (e.g. the modal contentEl). */
	bindPaste(scope: HTMLElement): void {
		this.unbindPaste();
		this.pasteScope = scope;
		this.pasteHandler = (e) => this.handlePaste(e);
		scope.addEventListener('paste', this.pasteHandler);
	}

	/** Removes all listeners and the zone element. */
	destroy(): void {
		this.unbindPaste();
		this.zoneEl.remove();
	}

	/** Detaches the paste listener from the previously bound scope. */
	private unbindPaste(): void {
		if (this.pasteScope && this.pasteHandler) {
			this.pasteScope.removeEventListener('paste', this.pasteHandler);
			this.pasteHandler = null;
			this.pasteScope = null;
		}
	}

	/** Creates the drop zone DOM element with icon and label. */
	private buildZone(parent: HTMLElement): HTMLElement {
		const zone = parent.createDiv({ cls: 'vw-drop-zone' });
		zone.setAttribute('tabindex', '0');
		if (this.config.icon) {
			const iconEl = zone.createSpan({ cls: 'vw-drop-zone-icon' });
			setIcon(iconEl, this.config.icon);
		}
		zone.createSpan({
			cls: 'vw-drop-zone-label',
			text: this.config.label ?? 'Drop here or paste from clipboard',
		});
		return zone;
	}

	/** Attaches drag-enter, drag-over, drag-leave, and drop listeners to the zone. */
	private attachDragListeners(): void {
		const zone = this.zoneEl;

		zone.addEventListener('dragenter', (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.dragCounter++;
			zone.addClass('vw-drop-zone-active');
		});

		zone.addEventListener('dragover', (e) => {
			e.preventDefault();
			e.stopPropagation();
			if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
		});

		zone.addEventListener('dragleave', (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.dragCounter--;
			if (this.dragCounter <= 0) {
				this.dragCounter = 0;
				zone.removeClass('vw-drop-zone-active');
			}
		});

		zone.addEventListener('drop', (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.dragCounter = 0;
			zone.removeClass('vw-drop-zone-active');
			this.handleDrop(e);
		});
	}

	/** Adds a click handler that triggers a clipboard read. */
	private attachClickToPaste(): void {
		this.zoneEl.addEventListener('click', () => this.readClipboard());
	}

	/** Reads clipboard content directly via the Clipboard API on click. */
	/** Reads files or text from the clipboard via the Clipboard API. */
	private async readClipboard(): Promise<void> {
		const items = await navigator.clipboard.read().catch((): ClipboardItem[] => []);
		for (const item of items) {
			const { mimeTypes } = this.config.accept;
			if (mimeTypes && mimeTypes.length > 0 && this.config.callbacks.onBlob) {
				for (const type of item.types) {
					if (this.matchesMime(type)) {
						const blob = await item.getType(type);
						this.flash();
						this.config.callbacks.onBlob(blob, type);
						return;
					}
				}
			}
		}

		if (items.length === 0) return;
		if (this.config.accept.text && this.config.callbacks.onText) {
			const hasFiles = items.some((item) =>
				item.types.some((t) => this.matchesMime(t)),
			);
			if (hasFiles) return;

			const text = await navigator.clipboard.readText().catch(() => '');
			if (text.trim().length > 0) {
				this.flash();
				this.config.callbacks.onText(text.trim());
			}
		}
	}

	/** Processes dropped files or vault paths from a drag event. */
	private handleDrop(e: DragEvent): void {
		const dt = e.dataTransfer;
		if (dt === null) return;

		if (dt.files.length > 0) {
			const accepted = this.filterFiles(dt.files);
			if (accepted.length > 0 && this.config.callbacks.onExternalFiles) {
				this.flash();
				this.config.callbacks.onExternalFiles(accepted);
			}
			return;
		}

		const text = dt.getData('text/plain');
		if (text && this.config.callbacks.onVaultPaths) {
			const paths = text.split('\n').map((p) => p.trim()).filter((p) => p.length > 0);
			if (paths.length > 0) {
				this.flash();
				this.config.callbacks.onVaultPaths(paths);
			}
		}
	}

	/** Handles paste events, filtering by accepted MIME types. */
	private handlePaste(e: ClipboardEvent): void {
		if (e.defaultPrevented) return;

		const ownerDoc = this.zoneEl.doc;
		const active = ownerDoc.activeElement;
		if (active === null) return;
		const el = active as HTMLElement;
		const isEditable = el.instanceOf(HTMLInputElement)
			|| el.instanceOf(HTMLTextAreaElement)
			|| (el.instanceOf(HTMLElement) && el.isContentEditable);
		if (isEditable && active !== this.zoneEl) return;

		const cd = e.clipboardData;
		if (cd === null) return;

		const { mimeTypes } = this.config.accept;
		if (mimeTypes && mimeTypes.length > 0) {
			for (let i = 0; i < cd.items.length; i++) {
				const item = cd.items[i];
				if (item.kind === 'file' && this.matchesMime(item.type)) {
					const blob = item.getAsFile();
					if (blob && this.config.callbacks.onBlob) {
						e.preventDefault();
						this.flash();
						this.config.callbacks.onBlob(blob, item.type);
						return;
					}
				}
			}
		}

		if (this.config.accept.text && this.config.callbacks.onText) {
			const hasFileItems = Array.from(cd.items).some((item) => item.kind === 'file');
			if (hasFileItems) return;

			const text = cd.getData('text/plain');
			if (text.trim().length > 0) {
				e.preventDefault();
				this.flash();
				this.config.callbacks.onText(text.trim());
			}
		}
	}

	/** Returns only files whose extensions match the accepted list. */
	private filterFiles(fileList: FileList): File[] {
		const { extensions } = this.config.accept;
		if (extensions === undefined || extensions.length === 0) {
			return Array.from(fileList);
		}
		return Array.from(fileList).filter((f) => {
			const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
			return extensions.includes(ext);
		});
	}

	/** Checks whether a MIME type matches any accepted pattern. */
	private matchesMime(type: string): boolean {
		const { mimeTypes } = this.config.accept;
		if (mimeTypes === undefined) return false;
		return mimeTypes.some((pattern) => {
			if (pattern.endsWith('/*')) {
				return type.startsWith(pattern.slice(0, -1));
			}
			return type === pattern;
		});
	}

	/** Brief highlight to confirm a successful drop or paste. */
	/** Brief highlight animation to confirm a successful drop or paste. */
	private flash(): void {
		this.zoneEl.addClass('vw-drop-zone-flash');
		setTimeout(() => this.zoneEl.removeClass('vw-drop-zone-flash'), 600);
	}
}
