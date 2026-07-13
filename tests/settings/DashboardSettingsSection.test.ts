import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import { DEFAULT_SETTINGS } from '../../src/core/types';
import type { SettingsSectionContext } from '../../src/settings/SettingsSectionContext';

interface CapturedButton {
	text: string;
	warning: boolean;
	onClickHandler?: () => void | Promise<void>;
}

interface CapturedSetting {
	name: string;
	button?: CapturedButton;
}

const ui = vi.hoisted(() => ({ rows: [] as CapturedSetting[] }));

vi.mock('obsidian', () => {
	class ColorPicker {
		setValue(): this { return this; }
		onChange(): this { return this; }
	}

	class Text {
		setValue(): this { return this; }
		onChange(): this { return this; }
	}

	class Button implements CapturedButton {
		text = '';
		warning = false;
		onClickHandler?: () => void | Promise<void>;

		setButtonText(value: string): this { this.text = value; return this; }
		setWarning(): this { this.warning = true; return this; }
		onClick(handler: () => void | Promise<void>): this { this.onClickHandler = handler; return this; }
	}

	class Setting implements CapturedSetting {
		name = '';
		button?: CapturedButton;

		constructor() { ui.rows.push(this); }
		setName(value: string): this { this.name = value; return this; }
		setDesc(): this { return this; }
		addColorPicker(callback: (colorPicker: ColorPicker) => void): this {
			callback(new ColorPicker());
			return this;
		}
		addText(callback: (text: Text) => void): this {
			callback(new Text());
			return this;
		}
		addButton(callback: (button: Button) => void): this {
			const button = new Button();
			callback(button);
			this.button = button;
			return this;
		}
	}

	return { Setting };
});

import { renderCategorySettings } from '../../src/settings/DashboardSettingsSection';

beforeEach(() => {
	ui.rows.length = 0;
});

describe('DashboardSettingsSection category deletion', () => {
	it('keeps automatic TODO imports pointed at a live category when the selected category is deleted', async () => {
		const settings = {
			...DEFAULT_SETTINGS,
			taskCategories: [
				{ id: 'default-daily', name: 'Daily Tasks', order: 0, isDefault: true as const, dailyReset: true as const },
				{ id: 'default-general', name: 'General', order: 1, isDefault: true as const },
				{ id: 'default-ai-tasks', name: 'AI Tasks', order: 2, isDefault: true as const },
				{ id: 'custom-selected', name: 'Imported', order: 3 },
			],
			todoCategoryId: 'custom-selected',
		};
		const save = vi.fn().mockImplementation(async () => {
			expect(settings.todoCategoryId).toBe('default-ai-tasks');
			expect(settings.taskCategories.some((category) => category.id === settings.todoCategoryId)).toBe(true);
		});
		const redisplay = vi.fn();
		const removeCategoryWithTasks = vi.fn((categoryId: string) => {
			settings.taskCategories = settings.taskCategories.filter((category) => category.id !== categoryId);
		});
		const context = {
			app: {} as App,
			plugin: {
				data: { settings },
				taskManager: { removeCategoryWithTasks },
			},
			save,
			redisplay,
		} as unknown as SettingsSectionContext;
		const element = { createEl: vi.fn() } as unknown as HTMLElement;

		renderCategorySettings(element, context);

		const importedCategory = ui.rows.find((row) => row.name === 'Imported');
		expect(importedCategory?.button?.text).toBe('Delete + Tasks');
		expect(importedCategory?.button?.warning).toBe(true);

		await importedCategory?.button?.onClickHandler?.();

		expect(removeCategoryWithTasks).toHaveBeenCalledWith('custom-selected');
		expect(settings.todoCategoryId).toBe('default-ai-tasks');
		expect(save).toHaveBeenCalledOnce();
		expect(redisplay).toHaveBeenCalledOnce();
	});
});
