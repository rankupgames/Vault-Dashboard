// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import { TFile } from 'obsidian';
import { LatestMarkdownModule, QuickAccessModule } from '../../src/modules/DocumentModule';
import type { ModuleConfig } from '../../src/core/types';

interface CreateElementOptions {
	cls?: string;
	text?: string;
}

interface ObsidianHTMLElement extends HTMLElement {
	createDiv(options?: CreateElementOptions | string): HTMLDivElement;
	createSpan(options?: CreateElementOptions | string): HTMLSpanElement;
	empty(): void;
	addClass(cls: string): void;
}

interface TestFileStat {
	ctime: number;
	mtime: number;
}

interface TestFile extends TFile {
	path: string;
	basename: string;
	stat: TestFileStat;
}

interface FakeLeaf {
	openFile: (file: TFile) => void;
}

interface FakeApp {
	vault: {
		getMarkdownFiles: () => TFile[];
		getAbstractFileByPath: (path: string) => TFile | null;
	};
	workspace: {
		getLeaf: (type: 'tab') => FakeLeaf;
	};
}

const moduleConfig: ModuleConfig = {
	id: 'latest-markdown',
	name: 'Latest Markdown Files',
	enabled: true,
	order: 1,
	collapsed: false,
};

const quickAccessConfig: ModuleConfig = {
	id: 'quick-access',
	name: 'Quick Access Documents',
	enabled: true,
	order: 0,
	collapsed: false,
};

const extendObsidianElementPrototype = (): void => {
	const proto = HTMLElement.prototype as ObsidianHTMLElement;

	proto.createDiv = function createDiv(options?: CreateElementOptions | string): HTMLDivElement {
		const child = this.ownerDocument.createElement('div');
		applyOptions(child, options);
		this.appendChild(child);
		return child;
	};

	proto.createSpan = function createSpan(options?: CreateElementOptions | string): HTMLSpanElement {
		const child = this.ownerDocument.createElement('span');
		applyOptions(child, options);
		this.appendChild(child);
		return child;
	};

	proto.empty = function empty(): void {
		this.replaceChildren();
	};

	proto.addClass = function addClass(cls: string): void {
		this.classList.add(cls);
	};
};

const applyOptions = (el: HTMLElement, options?: CreateElementOptions | string): void => {
	if (typeof options === 'string') {
		el.className = options;
		return;
	}
	if (options?.cls) el.className = options.cls;
	if (options?.text) el.textContent = options.text;
};

const makeFile = (path: string, basename: string, ctime: number): TestFile => {
	const FileCtor = TFile as unknown as new (path: string, basename: string, ctime: number) => TestFile;
	return new FileCtor(path, basename, ctime);
};

const makeApp = (files: TestFile[], openFile: (file: TFile) => void): App => {
	const byPath = new Map(files.map((file) => [file.path, file]));
	const fakeApp: FakeApp = {
		vault: {
			getMarkdownFiles: () => files,
			getAbstractFileByPath: (path) => byPath.get(path) ?? null,
		},
		workspace: {
			getLeaf: () => ({ openFile }),
		},
	};
	return fakeApp as unknown as App;
};

const getRows = (root: HTMLElement): HTMLElement[] =>
	[...root.querySelectorAll<HTMLElement>('.vw-doc-row')];

describe('LatestMarkdownModule', () => {
	beforeEach(() => {
		extendObsidianElementPrototype();
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-05-04T13:00:00'));
	});

	it('renders newest markdown files first and opens a file when the user clicks a row', () => {
		const newest = makeFile('Projects/New Spec.md', 'New Spec', Date.now() - 5 * 60_000);
		const older = makeFile('Projects/Older Note.md', 'Older Note', Date.now() - 3 * 60 * 60_000);
		const middle = makeFile('Projects/Middle Note.md', 'Middle Note', Date.now() - 45 * 60_000);
		const openFile = vi.fn();
		const app = makeApp([older, newest, middle], openFile);

		const root = document.createElement('div');
		new LatestMarkdownModule(app, moduleConfig, [], vi.fn()).renderContent(root);

		const rows = getRows(root);
		expect(rows).toHaveLength(3);
		expect(rows[0].querySelector('.vw-doc-link')?.textContent).toBe('New Spec');
		expect(rows[1].querySelector('.vw-doc-link')?.textContent).toBe('Middle Note');
		expect(rows[2].querySelector('.vw-doc-link')?.textContent).toBe('Older Note');
		expect(rows[0].querySelector('.vw-doc-meta')?.textContent).toBe('Added 5m ago');

		rows[0].click();

		expect(openFile).toHaveBeenCalledOnce();
		expect(openFile).toHaveBeenCalledWith(newest);
	});

	it('pins a latest markdown file to quick access without opening the document', () => {
		const newest = makeFile('WorkspaceVault/Business/Idea.md', 'Idea', Date.now() - 30_000);
		const openFile = vi.fn();
		const app = makeApp([newest], openFile);
		const quickAccessPaths: string[] = [];
		const persistQuickAccess = vi.fn();
		const quickAccessRoot = document.createElement('div');
		const quickAccess = new QuickAccessModule(app, quickAccessConfig, quickAccessPaths);
		quickAccess.onPathsChanged(persistQuickAccess);
		quickAccess.renderContent(quickAccessRoot);

		const root = document.createElement('div');
		new LatestMarkdownModule(
			app,
			moduleConfig,
			quickAccessPaths,
			(path) => quickAccess.addPath(path),
		).renderContent(root);

		const pinButton = root.querySelector<HTMLElement>('.vw-doc-pin');
		expect(pinButton).not.toBeNull();

		pinButton?.click();
		pinButton?.click();

		expect(openFile).not.toHaveBeenCalled();
		expect(persistQuickAccess).toHaveBeenCalledOnce();
		expect(quickAccessPaths).toEqual(['WorkspaceVault/Business/Idea.md']);
		expect(quickAccessRoot.querySelector('.vw-doc-link')?.textContent).toBe('Idea');
		expect(pinButton?.classList.contains('vw-doc-pinned')).toBe(true);
		expect(pinButton?.dataset.icon).toBe('check');
	});

	it('shows already pinned markdown files as complete on initial render', () => {
		const pinned = makeFile('WorkspaceVault/Business/Pinned.md', 'Pinned', Date.now() - 10_000);
		const app = makeApp([pinned], vi.fn());

		const root = document.createElement('div');
		new LatestMarkdownModule(
			app,
			moduleConfig,
			['WorkspaceVault/Business/Pinned.md'],
			vi.fn(),
		).renderContent(root);

		const pinButton = root.querySelector<HTMLElement>('.vw-doc-pin');
		expect(pinButton?.classList.contains('vw-doc-pinned')).toBe(true);
		expect(pinButton?.dataset.icon).toBe('check');
		expect(pinButton?.getAttribute('title')).toBe('Already in quick access');
	});
});
