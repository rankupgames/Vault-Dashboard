// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import { TaskManager } from '../../src/core/TaskManager';
import { DEFAULT_SETTINGS, type PluginSettings } from '../../src/core/types';
import { BoardView, type BoardViewDeps } from '../../src/sections/BoardView';

interface CreateElementOptions {
	cls?: string;
	text?: string;
}

interface ObsidianHTMLElement extends HTMLElement {
	createDiv(options?: CreateElementOptions | string): HTMLDivElement;
	createSpan(options?: CreateElementOptions | string): HTMLSpanElement;
	addClass(cls: string): void;
}

/** Adds the Obsidian element helpers used by BoardView to the test DOM. */
const extendObsidianElementPrototype = (): void => {
	const prototype = HTMLElement.prototype as ObsidianHTMLElement;

	prototype.createDiv = function createDiv(options?: CreateElementOptions | string): HTMLDivElement {
		const child = this.ownerDocument.createElement('div');
		applyOptions(child, options);
		this.appendChild(child);
		return child;
	};

	prototype.createSpan = function createSpan(options?: CreateElementOptions | string): HTMLSpanElement {
		const child = this.ownerDocument.createElement('span');
		applyOptions(child, options);
		this.appendChild(child);
		return child;
	};

	prototype.addClass = function addClass(cls: string): void {
		this.classList.add(cls);
	};
};

/** Applies the options accepted by Obsidian's createDiv/createSpan helpers. */
const applyOptions = (element: HTMLElement, options?: CreateElementOptions | string): void => {
	if (typeof options === 'string') {
		element.className = options;
		return;
	}
	if (options?.cls !== undefined) element.className = options.cls;
	if (options?.text !== undefined) element.textContent = options.text;
};

/** Returns an independent settings object for each interaction test. */
const makeSettings = (): PluginSettings => JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as PluginSettings;

/** Creates a drag event with the geometry and data-transfer fields BoardView consumes. */
const makeDragEvent = (type: string, clientY = 0): DragEvent => {
	const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
	const dataTransfer = {
		dropEffect: 'none',
		effectAllowed: 'uninitialized',
		setData: vi.fn(),
		getData: vi.fn(),
	} as unknown as DataTransfer;
	Object.defineProperties(event, {
		clientY: { value: clientY },
		dataTransfer: { value: dataTransfer },
	});
	return event;
};

/** Finds the rendered card for a task title. */
const getTaskRow = (root: HTMLElement, title: string): HTMLElement | undefined =>
	[...root.querySelectorAll<HTMLElement>('.vw-board-task-row')].find((row) =>
		row.querySelector('.vw-board-task-title')?.textContent === title,
	);

/** Builds BoardView with real task state and observable persistence callbacks. */
const renderBoard = (taskManager: TaskManager, settings: PluginSettings): {
	root: HTMLElement;
	saveCallback: ReturnType<typeof vi.fn>;
	onRenderAll: ReturnType<typeof vi.fn>;
	onEditTask: ReturnType<typeof vi.fn>;
} => {
	const saveCallback = vi.fn();
	const onRenderAll = vi.fn();
	const onEditTask = vi.fn();
	const app = { workspace: { openLinkText: vi.fn() } } as unknown as App;
	const deps: BoardViewDeps = {
		app,
		taskManager,
		onRenderAll,
		saveCallback,
		settings,
		onEditTask,
		aiDispatcher: {} as BoardViewDeps['aiDispatcher'],
		references: [],
	};
	const root = document.createElement('div');
	new BoardView(deps).render(root);
	return { root, saveCallback, onRenderAll, onEditTask };
};

describe('BoardView task interactions', () => {
	beforeEach(() => {
		extendObsidianElementPrototype();
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it('reorders a dragged task card without starting a category drag', () => {
		const settings = makeSettings();
		const taskManager = new TaskManager([], [], settings);
		const first = taskManager.addTask('First', 30);
		const second = taskManager.addTask('Second', 30);
		const third = taskManager.addTask('Third', 30);
		for (const task of [first, second]) {
			taskManager.assignTaskCategory(task.id, 'default-general');
		}
		taskManager.assignTaskCategory(third.id, 'default-daily');
		const reorderCategories = vi.spyOn(taskManager, 'reorderCategories');
		const { root, saveCallback, onRenderAll } = renderBoard(taskManager, settings);
		const sourceRow = getTaskRow(root, 'Third');
		const targetRow = getTaskRow(root, 'First');
		expect(sourceRow).toBeDefined();
		expect(targetRow).toBeDefined();
		if (sourceRow === undefined || targetRow === undefined) return;

		vi.spyOn(targetRow, 'getBoundingClientRect').mockReturnValue({
			bottom: 100,
			height: 100,
			left: 0,
			right: 100,
			top: 0,
			width: 100,
			x: 0,
			y: 0,
			toJSON: () => ({}),
		});

		sourceRow.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
		vi.advanceTimersByTime(1_000);
		expect(sourceRow.getAttribute('draggable')).toBe('true');
		const taskDragStart = makeDragEvent('dragstart');
		sourceRow.dispatchEvent(taskDragStart);
		expect(taskDragStart.defaultPrevented).toBe(false);

		const sourceColumn = sourceRow.closest('.vw-board-column');
		expect(sourceColumn?.getAttribute('draggable')).toBeNull();
		expect(sourceColumn?.classList.contains('vw-board-column-dragging')).toBe(false);

		targetRow.dispatchEvent(makeDragEvent('dragover', 25));
		targetRow.dispatchEvent(makeDragEvent('drop', 25));

		expect(taskManager.getTasks().map((task) => task.id)).toEqual([third.id, first.id, second.id]);
		expect(taskManager.getTask(third.id)?.categoryId).toBe('default-general');
		expect(reorderCategories).not.toHaveBeenCalled();
		expect(saveCallback).toHaveBeenCalledOnce();
		expect(onRenderAll).toHaveBeenCalledOnce();
	});

	it('marks a task complete from its status dot and persists the rerender', () => {
		const settings = makeSettings();
		const taskManager = new TaskManager([], [], settings);
		const task = taskManager.addTask('Finish this', 30);
		taskManager.assignTaskCategory(task.id, 'default-general');
		const { root, saveCallback, onRenderAll, onEditTask } = renderBoard(taskManager, settings);
		const row = getTaskRow(root, task.title);
		const statusDot = row?.querySelector<HTMLElement>('.vw-board-task-dot');
		expect(statusDot).not.toBeNull();

		statusDot?.click();

		expect(taskManager.getTask(task.id)?.status).toBe('completed');
		expect(saveCallback).toHaveBeenCalledOnce();
		expect(onRenderAll).toHaveBeenCalledOnce();
		expect(onEditTask).not.toHaveBeenCalled();
	});
});
