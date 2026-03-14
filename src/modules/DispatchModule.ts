/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard
 * Description: Module showing active and recent AI dispatches with take-over capability
 * Created: 2026-03-09
 * Last Modified: 2026-03-09
 */

import { Notice, setIcon } from 'obsidian';
import { PluginSettings } from '../core/types';
import { ModuleRenderer } from './ModuleCard';
import type { DispatchRecord } from '../services/AIDispatcher';

/**
 * Data provider contract so DispatchModule stays decoupled from AIDispatcher.
 * Any static class or instance that satisfies this shape can drive the module.
 */
export interface DispatchProvider {
	onDispatchChange(fn: () => void): () => void;
	getDispatches(): DispatchRecord[];
	clearFinished(): void;
	clearAll(): void;
	openTerminal(vaultPath: string, terminalApp: 'ghostty' | 'terminal'): void;
	openIDE(cwd: string, ide: 'cursor' | 'vscode'): void;
	completeTask(taskId: string): void;
	approvePlan(planId: string): void;
	rejectPlan(planId: string): void;
	previewPlan(record: DispatchRecord): void;
	retryDispatch(recordId: string): void;
}

/** Module that renders live AI dispatch status with terminal take-over. */
export class DispatchModule implements ModuleRenderer {
	readonly id = 'ai-dispatches';
	readonly name = 'AI Dispatches';
	readonly showRefresh = true;

	private settings: PluginSettings;
	private provider: DispatchProvider;
	private unsubscribe: (() => void) | null = null;
	private timerHandle: ReturnType<typeof setInterval> | null = null;
	private bodyEl: HTMLElement | null = null;
	private expandedIds = new Set<string>();

	/** Creates the dispatch module with settings and a data provider. */
	constructor(settings: PluginSettings, provider: DispatchProvider) {
		this.settings = settings;
		this.provider = provider;
	}

	/** Renders the dispatch list into the element and subscribes to provider changes. */
	renderContent(el: HTMLElement): void {
		this.bodyEl = el;
		this.unsubscribe?.();
		this.unsubscribe = this.provider.onDispatchChange(() => this.rebuildList());
		this.startElapsedTimer();
		this.rebuildList();
	}

	/** Renders clear-all, clear-finished, and refresh buttons into the actions container. */
	renderHeaderActions(actionsEl: HTMLElement): void {
		const clearAllBtn = actionsEl.createDiv({ cls: 'vw-module-refresh' });
		setIcon(clearAllBtn, 'x-circle');
		clearAllBtn.setAttribute('aria-label', 'Clear all dispatches');
		clearAllBtn.setAttribute('tabindex', '0');
		clearAllBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			this.provider.clearAll();
		});

		const clearBtn = actionsEl.createDiv({ cls: 'vw-module-refresh' });
		setIcon(clearBtn, 'trash-2');
		clearBtn.setAttribute('aria-label', 'Clear finished');
		clearBtn.setAttribute('tabindex', '0');
		clearBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			this.provider.clearFinished();
		});

		const refreshBtn = actionsEl.createDiv({ cls: 'vw-module-refresh' });
		setIcon(refreshBtn, 'refresh-cw');
		refreshBtn.setAttribute('aria-label', 'Refresh');
		refreshBtn.setAttribute('tabindex', '0');
		refreshBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			this.rebuildList();
		});
	}

	destroy(): void {
		this.unsubscribe?.();
		this.unsubscribe = null;
		if (this.timerHandle) {
			clearInterval(this.timerHandle);
			this.timerHandle = null;
		}
		this.bodyEl = null;
	}

	/** Starts a 1-second interval that refreshes elapsed time badges for running dispatches. */
	private startElapsedTimer(): void {
		if (this.timerHandle) clearInterval(this.timerHandle);
		this.timerHandle = setInterval(() => {
			if (this.bodyEl === null) return;
			const dispatches = this.provider.getDispatches();
			if (dispatches.some((d) => d.status === 'running' || d.status === 'plan-pending') === false) return;
			this.bodyEl.querySelectorAll('.vw-dispatch-elapsed').forEach((el) => {
				const start = Number(el.getAttribute('data-start'));
				if (start) el.textContent = this.formatElapsed(Date.now() - start);
			});
		}, 1000);
	}

	/** Clears and re-renders the dispatch list from current provider data. */
	private rebuildList(): void {
		if (this.bodyEl === null) return;
		this.bodyEl.empty();

		const dispatches = this.provider.getDispatches();
		if (dispatches.length === 0) {
			this.bodyEl.createDiv({ cls: 'vw-module-empty', text: 'No dispatches yet' });
			return;
		}

		const list = this.bodyEl.createDiv({ cls: 'vw-dispatch-list' });
		for (const rec of dispatches) {
			this.renderRow(list, rec);
		}
	}

	/** Renders a single dispatch record row with status, actions, and expandable output. */
	private renderRow(list: HTMLElement, rec: DispatchRecord): void {
		const wrapper = list.createDiv({ cls: 'vw-dispatch-item' });
		const row = wrapper.createDiv({ cls: `vw-dispatch-row vw-dispatch-${rec.status}` });

		const statusIcon = row.createDiv({ cls: 'vw-dispatch-status-icon' });
		const iconMap: Record<string, string> = {
			running: 'loader',
			completed: 'check-circle',
			failed: 'alert-circle',
			'plan-pending': 'loader',
			'plan-ready': 'file-check',
			'plan-approved': 'clipboard-check',
			'plan-rejected': 'x-circle',
		};
		setIcon(statusIcon, iconMap[rec.status] ?? 'help-circle');
		if (rec.status === 'running' || rec.status === 'plan-pending') statusIcon.addClass('vw-dispatch-spin');

		const info = row.createDiv({ cls: 'vw-dispatch-info' });
		info.createDiv({ cls: 'vw-dispatch-title', text: rec.label });

		const meta = info.createDiv({ cls: 'vw-dispatch-meta' });
		meta.createSpan({ cls: 'vw-dispatch-tool', text: rec.tool });

		const elapsed = rec.endTime ? rec.endTime - rec.startTime : Date.now() - rec.startTime;
		const elapsedEl = meta.createSpan({ cls: 'vw-dispatch-elapsed', text: this.formatElapsed(elapsed) });
		if (rec.status === 'running' || rec.status === 'plan-pending') {
			elapsedEl.setAttribute('data-start', String(rec.startTime));
		}

		if (rec.pid && (rec.status === 'running' || rec.status === 'plan-pending')) {
			meta.createSpan({ cls: 'vw-dispatch-pid', text: `PID ${rec.pid}` });
		}

		const actions = row.createDiv({ cls: 'vw-dispatch-actions' });

		const hasOutput = rec.output || rec.error;
		if (hasOutput) {
			const expandBtn = actions.createDiv({ cls: 'vw-dispatch-action-btn' });
			const isExpanded = this.expandedIds.has(rec.id);
			setIcon(expandBtn, isExpanded ? 'chevron-up' : 'chevron-down');
			expandBtn.setAttribute('aria-label', isExpanded ? 'Collapse output' : 'Expand output');
			expandBtn.setAttribute('tabindex', '0');
			expandBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				if (this.expandedIds.has(rec.id)) {
					this.expandedIds.delete(rec.id);
				} else {
					this.expandedIds.add(rec.id);
				}
				this.rebuildList();
			});
		}

		if (rec.planText) {
			const viewPlanBtn = actions.createDiv({ cls: 'vw-dispatch-action-btn' });
			setIcon(viewPlanBtn, 'file-text');
			viewPlanBtn.setAttribute('aria-label', 'View plan');
			viewPlanBtn.setAttribute('tabindex', '0');
			viewPlanBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				this.provider.previewPlan(rec);
			});
		}

		if (rec.status === 'running' || rec.status === 'plan-pending') {
			const takeOverBtn = actions.createDiv({ cls: 'vw-dispatch-action-btn' });
			setIcon(takeOverBtn, 'terminal');
			takeOverBtn.setAttribute('aria-label', `Switch to ${this.settings.terminalApp === 'ghostty' ? 'Ghostty' : 'Terminal'}`);
			takeOverBtn.setAttribute('tabindex', '0');
			takeOverBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				this.provider.openTerminal(rec.vaultPath, this.settings.terminalApp);
			});
			takeOverBtn.addEventListener('keydown', (e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.stopPropagation();
					e.preventDefault();
					this.provider.openTerminal(rec.vaultPath, this.settings.terminalApp);
				}
			});
		}

		if (rec.status === 'plan-ready') {
			const approveBtn = actions.createDiv({ cls: 'vw-dispatch-action-btn vw-dispatch-approve-btn' });
			setIcon(approveBtn, 'check');
			approveBtn.setAttribute('aria-label', 'Approve plan');
			approveBtn.setAttribute('tabindex', '0');
			approveBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				this.provider.approvePlan(rec.id);
			});

			const rejectBtn = actions.createDiv({ cls: 'vw-dispatch-action-btn vw-dispatch-reject-btn' });
			setIcon(rejectBtn, 'x');
			rejectBtn.setAttribute('aria-label', 'Reject plan');
			rejectBtn.setAttribute('tabindex', '0');
			rejectBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				this.provider.rejectPlan(rec.id);
			});
		}

		if (rec.status === 'failed' && rec.taskId) {
			const retryBtn = actions.createDiv({ cls: 'vw-dispatch-action-btn vw-dispatch-retry-btn' });
			setIcon(retryBtn, 'refresh-cw');
			retryBtn.setAttribute('aria-label', 'Retry dispatch');
			retryBtn.setAttribute('tabindex', '0');
			retryBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				this.provider.retryDispatch(rec.id);
			});
			retryBtn.addEventListener('keydown', (e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.stopPropagation();
					e.preventDefault();
					this.provider.retryDispatch(rec.id);
				}
			});
		}

		if (hasOutput) {
			const copyBtn = actions.createDiv({ cls: 'vw-dispatch-action-btn' });
			setIcon(copyBtn, 'copy');
			copyBtn.setAttribute('aria-label', 'Copy output');
			copyBtn.setAttribute('tabindex', '0');
			copyBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				const text = rec.output || rec.error || '';
				navigator.clipboard.writeText(text).then(() => new Notice('Output copied'));
			});
		}

		if (rec.status === 'completed' && this.settings.postDispatchIDE !== 'none') {
			const ideBtn = actions.createDiv({ cls: 'vw-dispatch-action-btn' });
			setIcon(ideBtn, 'external-link');
			const ideLabel = this.settings.postDispatchIDE === 'cursor' ? 'Cursor' : 'VS Code';
			ideBtn.setAttribute('aria-label', `Open in ${ideLabel}`);
			ideBtn.setAttribute('tabindex', '0');
			ideBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				this.provider.openIDE(rec.vaultPath, this.settings.postDispatchIDE as 'cursor' | 'vscode');
			});
			ideBtn.addEventListener('keydown', (e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.stopPropagation();
					e.preventDefault();
					this.provider.openIDE(rec.vaultPath, this.settings.postDispatchIDE as 'cursor' | 'vscode');
				}
			});
		}

		if (rec.status === 'completed' && rec.taskId) {
			const completeBtn = actions.createDiv({ cls: 'vw-dispatch-action-btn vw-dispatch-complete-btn' });
			setIcon(completeBtn, 'check-circle');
			completeBtn.setAttribute('aria-label', 'Mark task complete');
			completeBtn.setAttribute('tabindex', '0');
			completeBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				this.provider.completeTask(rec.taskId);
				new Notice(`Task "${rec.taskTitle}" marked complete`);
			});
			completeBtn.addEventListener('keydown', (e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.stopPropagation();
					e.preventDefault();
					this.provider.completeTask(rec.taskId);
					new Notice(`Task "${rec.taskTitle}" marked complete`);
				}
			});
		}

		if (this.expandedIds.has(rec.id) && hasOutput) {
			const outputPanel = wrapper.createDiv({ cls: 'vw-dispatch-output' });
			const content = rec.output || rec.error || '';
			const truncated = content.length > 2000 ? content.substring(0, 2000) + '\n... (truncated)' : content;
			outputPanel.createEl('pre', { cls: 'vw-dispatch-output-pre', text: truncated });
		}
	}

	/** Formats a millisecond duration as a compact human-readable string (e.g. "3m 12s"). */
	private formatElapsed(ms: number): string {
		const totalSec = Math.floor(ms / 1000);
		if (totalSec < 60) return `${totalSec}s`;
		const m = Math.floor(totalSec / 60);
		const s = totalSec % 60;
		if (m < 60) return `${m}m ${s}s`;
		const h = Math.floor(m / 60);
		return `${h}h ${m % 60}m`;
	}
}
