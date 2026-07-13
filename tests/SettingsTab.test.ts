// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import type { SettingsSectionContext } from '../src/settings/SettingsSectionContext';

const mocks = vi.hoisted(() => {
	const renderOrder: string[] = [];
	let capturedContext: unknown;
	const renderer = (name: string) => vi.fn((_element: unknown, context: unknown) => {
		renderOrder.push(name);
		capturedContext = context;
	});
	return {
		renderOrder,
		getCapturedContext: () => capturedContext,
		clearCapturedContext: () => { capturedContext = undefined; },
		renderGeneralSettings: renderer('general'),
		renderTimerSettings: renderer('timer'),
		renderAudioSettings: renderer('audio'),
		renderAISettings: renderer('ai'),
		renderGmailSettings: renderer('gmail'),
		renderTaskSettings: renderer('tasks'),
		renderTagSettings: renderer('tags'),
		renderTaskTreeSettings: renderer('task-tree'),
		renderHeatmapSettings: renderer('heatmap'),
		renderReportSettings: renderer('reports'),
		renderCategorySettings: renderer('categories'),
		renderModuleSettings: renderer('modules'),
		renderExportSettings: renderer('export'),
		renderDataSettings: renderer('data'),
	};
});

vi.mock('../src/settings/GeneralSettingsSection', () => ({
	renderGeneralSettings: mocks.renderGeneralSettings,
	renderTimerSettings: mocks.renderTimerSettings,
	renderAudioSettings: mocks.renderAudioSettings,
}));
vi.mock('../src/settings/AISettingsSection', () => ({ renderAISettings: mocks.renderAISettings }));
vi.mock('../src/settings/GmailSettingsSection', () => ({ renderGmailSettings: mocks.renderGmailSettings }));
vi.mock('../src/settings/TaskSettingsSection', () => ({
	renderTaskSettings: mocks.renderTaskSettings,
	renderTagSettings: mocks.renderTagSettings,
}));
vi.mock('../src/settings/DashboardSettingsSection', () => ({
	renderTaskTreeSettings: mocks.renderTaskTreeSettings,
	renderHeatmapSettings: mocks.renderHeatmapSettings,
	renderReportSettings: mocks.renderReportSettings,
	renderCategorySettings: mocks.renderCategorySettings,
	renderModuleSettings: mocks.renderModuleSettings,
}));
vi.mock('../src/settings/DataSettingsSection', () => ({
	renderExportSettings: mocks.renderExportSettings,
	renderDataSettings: mocks.renderDataSettings,
}));

import { SettingsTab } from '../src/SettingsTab';

describe('SettingsTab orchestration', () => {
	beforeEach(() => {
		mocks.renderOrder.length = 0;
		mocks.clearCapturedContext();
	});

	it('invokes focused renderers in the established section order', () => {
		const plugin = {
			data: {},
			saveData: vi.fn(),
			refreshWelcomeViews: vi.fn(),
		};
		const tab = new SettingsTab({} as App, plugin as never);
		(tab.containerEl as HTMLElement & { empty: () => void }).empty = vi.fn();

		tab.display();

		expect(mocks.renderOrder).toEqual([
			'general',
			'timer',
			'audio',
			'ai',
			'gmail',
			'tasks',
			'tags',
			'task-tree',
			'heatmap',
			'reports',
			'categories',
			'modules',
			'export',
			'data',
		]);
	});

	it('provides bound persistence and redisplay callbacks to extracted sections', async () => {
		const plugin = {
			data: { settings: {} },
			saveData: vi.fn().mockResolvedValue(undefined),
			refreshWelcomeViews: vi.fn(),
		};
		const tab = new SettingsTab({} as App, plugin as never);
		(tab.containerEl as HTMLElement & { empty: () => void }).empty = vi.fn();
		tab.display();

		const context = mocks.getCapturedContext() as SettingsSectionContext | undefined;
		await context?.save();
		expect(plugin.saveData).toHaveBeenCalledWith(plugin.data);
		expect(plugin.refreshWelcomeViews).toHaveBeenCalledOnce();

		mocks.renderOrder.length = 0;
		context?.redisplay();
		expect(mocks.renderOrder).toHaveLength(14);
	});
});
