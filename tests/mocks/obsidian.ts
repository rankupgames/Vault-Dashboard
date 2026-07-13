export interface FileStat {
	ctime: number;
	mtime: number;
	size?: number;
}

export class TAbstractFile {
	path: string;
	name: string;

	constructor(path = '') {
		this.path = path;
		this.name = path.split('/').pop() ?? path;
	}
}

export class TFile extends TAbstractFile {
	basename: string;
	extension: string;
	stat: FileStat;

	constructor(path: string, basename?: string, ctime = Date.now()) {
		super(path);
		this.extension = path.split('.').pop() ?? '';
		this.basename = basename ?? this.name.replace(/\.[^.]+$/, '');
		this.stat = { ctime, mtime: ctime };
	}
}

export class TFolder extends TAbstractFile {
	children: TAbstractFile[] = [];
}

export class Modal {
	app: unknown;
	contentEl: HTMLElement;

	constructor(app: unknown) {
		this.app = app;
		this.contentEl = document.createElement('div');
	}

	open(): void {
		this.onOpen();
	}

	close(): void {
		this.onClose();
	}

	onOpen(): void {
		// Test shim.
	}

	onClose(): void {
		// Test shim.
	}
}

export class FuzzySuggestModal<T> extends Modal {
	protected placeholder = '';

	setPlaceholder(placeholder: string): void {
		this.placeholder = placeholder;
	}

	getItems(): T[] {
		return [];
	}

	getItemText(_item: T): string {
		return '';
	}

	onChooseItem(_item: T): void {
		// Test shim.
	}
}

/** Minimal Obsidian settings tab surface used to exercise section orchestration. */
export class PluginSettingTab {
	/** Application dependency supplied to the settings tab. */
	app: unknown;
	/** DOM root that settings renderers populate during tests. */
	containerEl: HTMLElement;

	/** Creates a test settings surface without loading the real Obsidian runtime. */
	constructor(app: unknown, _plugin: unknown) {
		this.app = app;
		this.containerEl = document.createElement('div');
	}

	/** Provides the overridable display contract exposed by Obsidian. */
	display(): void {
		// Test shim.
	}
}

export class Notice {
	message: string;

	constructor(message: string) {
		this.message = message;
	}
}

export const setIcon = (el: HTMLElement, icon: string): void => {
	el.dataset.icon = icon;
};

export const normalizePath = (path: string): string =>
	path.replace(/\\/g, '/').replace(/\/+/g, '/');
