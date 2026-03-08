/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard Welcome
 * Description: Renders subtask branches in a git-style tree with toggle, rename, add, and remove
 * Created: 2026-03-07
 * Last Modified: 2026-03-07
 */

import { setIcon } from 'obsidian';
import { SubTask } from '../types';
import { attachOverflowTooltip } from '../Tooltip';

const collapsedSubtaskIds = new Set<string>();

export class SubtaskTree {
	private onBeforeChange: (() => void) | null;
	private onChanged: (() => void) | null;

	constructor(onChanged?: () => void, onBeforeChange?: () => void) {
		this.onChanged = onChanged ?? null;
		this.onBeforeChange = onBeforeChange ?? null;
	}

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
				setIcon(toggle, collapsedSubtaskIds.has(sub.id) ? 'chevron-right' : 'chevron-down');
				toggle.addEventListener('click', (e) => {
					e.stopPropagation();
					if (collapsedSubtaskIds.has(sub.id)) {
						collapsedSubtaskIds.delete(sub.id);
					} else {
						collapsedSubtaskIds.add(sub.id);
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

			if (hasChildren && collapsedSubtaskIds.has(sub.id) === false) {
				const children = wrapper.createDiv({ cls: 'vw-git-branch-children' });
				this.renderBranch(children, sub.subtasks!, depth + 1);
			}
		}
	}
}
