import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AI_TOOL, DEFAULT_SETTINGS } from '../../src/core/types';
import type { SettingsSectionContext } from '../../src/settings/SettingsSectionContext';

interface CapturedTextArea {
	inputEl: { rows: number };
	placeholder: string;
	value: string;
	onChangeHandler?: (value: string) => void | Promise<void>;
}

interface CapturedSetting {
	name: string;
	description: string;
	textArea?: CapturedTextArea;
}

const ui = vi.hoisted(() => ({ rows: [] as CapturedSetting[] }));

vi.mock('obsidian', () => {
	class Dropdown {
		addOption(): this { return this; }
		setValue(): this { return this; }
		onChange(): this { return this; }
	}

	class TextArea implements CapturedTextArea {
		inputEl = { rows: 0 };
		placeholder = '';
		value = '';
		onChangeHandler?: (value: string) => void | Promise<void>;

		setPlaceholder(value: string): this { this.placeholder = value; return this; }
		setValue(value: string): this { this.value = value; return this; }
		onChange(handler: (value: string) => void | Promise<void>): this { this.onChangeHandler = handler; return this; }
	}

	class Setting implements CapturedSetting {
		name = '';
		description = '';
		textArea?: CapturedTextArea;

		constructor() { ui.rows.push(this); }
		setName(value: string): this { this.name = value; return this; }
		setDesc(value: string): this { this.description = value; return this; }
		addDropdown(callback: (dropdown: Dropdown) => void): this { callback(new Dropdown()); return this; }
		addTextArea(callback: (textArea: TextArea) => void): this {
			const textArea = new TextArea();
			callback(textArea);
			this.textArea = textArea;
			return this;
		}
	}

	return { Notice: class {}, Setting };
});

vi.mock('../../src/services/KeychainSecrets', () => ({
	deleteKeychainSecret: vi.fn(),
	hasKeychainSecret: vi.fn(),
	setKeychainSecret: vi.fn(),
}));

import { renderAISettings } from '../../src/settings/AISettingsSection';

beforeEach(() => {
	ui.rows.length = 0;
});

describe('AI task-session settings', () => {
	it('renders honest skill/tool textareas and saves normalized comma/newline lists', async () => {
		const settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
		settings.aiTool = AI_TOOL.NONE;
		settings.aiTaskSkills = ['review-code', 'write-tests'];
		settings.aiTaskTools = ['Read', 'Edit'];
		const save = vi.fn().mockResolvedValue(undefined);
		const context = {
			plugin: {
				data: { settings },
				aiDispatcher: { isProviderAvailable: vi.fn().mockReturnValue(false) },
			},
			save,
			redisplay: vi.fn(),
		} as unknown as SettingsSectionContext;
		const element = { createEl: vi.fn() } as unknown as HTMLElement;

		renderAISettings(element, context);

		const skills = ui.rows.find((row) => row.name === 'Task session skills');
		const tools = ui.rows.find((row) => row.name === 'Task session tools');
		expect(skills?.description).toContain('does not install or enable skills');
		expect(tools?.description).toContain('does not grant permissions or guarantee provider support');
		expect(skills?.textArea?.value).toBe('review-code\nwrite-tests');
		expect(tools?.textArea?.value).toBe('Read\nEdit');
		expect(skills?.textArea?.inputEl.rows).toBe(3);

		await skills?.textArea?.onChangeHandler?.('review-code, debug\nwrite-tests, review-code');
		await tools?.textArea?.onChangeHandler?.('Read, Bash\nEdit, Read');

		expect(settings.aiTaskSkills).toEqual(['review-code', 'debug', 'write-tests']);
		expect(settings.aiTaskTools).toEqual(['Read', 'Bash', 'Edit']);
		expect(save).toHaveBeenCalledTimes(2);
	});
});
