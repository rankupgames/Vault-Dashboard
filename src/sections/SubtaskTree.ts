/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard Welcome
 * Description: Renders subtask branches in a git-style tree with toggle, rename, add, and remove
 * Created: 2026-03-07
 * Last Modified: 2026-03-09
 */

import { Notice, setIcon } from 'obsidian';
import { SubTask } from '../core/types';
import { attachOverflowTooltip } from '../ui/Tooltip';
import { TaskFormatter } from '../core/TaskFormatter';

/** View state for subtask tree collapse state. */
export interface SubtreeViewState {
	/** Subtask IDs whose children are collapsed. */
	collapsedSubtaskIds: Set<string>;
}

/** Creates initial subtask tree view state. */
export function createSubtreeViewState(): SubtreeViewState {
	return { collapsedSubtaskIds: new Set<string>() };
}

/** Renders subtask branches in a git-style tree with toggle, rename, add, and remove. */
export class SubtaskTree {
	private onBeforeChange: (() => void) | null;
	private onChanged: (() => void) | null;
	private vs: SubtreeViewState;

	/** Creates the subtask tree with view state and optional change callbacks. */
	constructor(vs: SubtreeViewState, onChanged?: () => void, onBeforeChange?: () => void) {
		this.vs = vs;
		this.onChanged = onChanged ?? null;
		this.onBeforeChange = onBeforeChange ?? null;
	}

	/**
	 * Renders a branch of subtasks into the parent.
	 * @param parent - Container element
	 * @param subtasks - Subtasks to render
	 * @param depth - Nesting depth (1-based)
	 */
	renderBranch(
		parent: HTMLElement,
		subtasks: SubTask[],
		depth: number,
	): void {
		const depthIdx = Math.min(depth - 1, 3);

		const container = depth === 1
			? parent.createDiv({ cls: 'vw-git-branch' })
			: parent;

		for (const sub of subtasks) {
			const wrapper = container.createDiv({ cls: `vw-git-branch-wrap vw-git-depth-${depthIdx}` });

			const row = wrapper.createDiv({ cls: 'vw-git-branch-row' });

			const hasChildren = sub.subtasks && sub.subtasks.length > 0;
			if (hasChildren) {
				const toggle = wrapper.createDiv({ cls: 'vw-branch-collapse' });
				toggle.style.left = `${-35.5 - (depth - 1) * 41.5}px`;
				setIcon(toggle, this.vs.collapsedSubtaskIds.has(sub.id) ? 'chevron-right' : 'chevron-down');
				toggle.addEventListener('click', (e) => {
					e.stopPropagation();
					if (this.vs.collapsedSubtaskIds.has(sub.id)) {
						this.vs.collapsedSubtaskIds.delete(sub.id);
					} else {
						this.vs.collapsedSubtaskIds.add(sub.id);
					}
					if (this.onChanged) this.onChanged();
				});
			}

			const subDotCls = sub.status === 'completed' ? 'vw-git-sub-dot vw-git-sub-dot-completed' : 'vw-git-sub-dot';
			const dotEl = row.createDiv({ cls: subDotCls });
			dotEl.style.cursor = 'pointer';
			dotEl.setAttribute('aria-label', sub.status === 'completed' ? 'Mark pending' : 'Mark complete');
			dotEl.addEventListener('click', (e) => {
				e.stopPropagation();
				if (this.onBeforeChange) this.onBeforeChange();
				sub.status = sub.status === 'completed' ? 'pending' : 'completed';
				if (this.onChanged) this.onChanged();
			});

			const subInfo = row.createDiv({ cls: `vw-subtask-row ${sub.status === 'completed' ? 'vw-subtask-completed' : ''}` });
			const textEl = subInfo.createSpan({ cls: 'vw-subtask-text', text: sub.title });
			attachOverflowTooltip(textEl, sub.title);

			const actionsEl = row.createDiv({ cls: 'vw-subtask-actions' });
			const copyBtn = actionsEl.createDiv({ cls: 'vw-subtask-copy-btn' });
			setIcon(copyBtn, 'clipboard-copy');
			copyBtn.setAttribute('aria-label', 'Copy subtask');
			copyBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				const text = TaskFormatter.formatSubtasks([sub]);
				navigator.clipboard.writeText(text).then(() => new Notice('Subtask copied'));
			});

			if (hasChildren && this.vs.collapsedSubtaskIds.has(sub.id) === false) {
				const children = wrapper.createDiv({ cls: 'vw-git-branch-children' });
				this.renderBranch(children, sub.subtasks!, depth + 1);
			}
		}
	}
}
