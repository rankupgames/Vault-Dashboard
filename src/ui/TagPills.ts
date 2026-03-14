/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard Welcome
 * Description: Reusable tag pill strip with optional remove buttons
 * Created: 2026-03-13
 * Last Modified: 2026-03-13
 */

import { setIcon } from 'obsidian';

/** Configuration for a TagPills instance. */
export interface TagPillsConfig {
	/** Tag-to-hex-color mapping. */
	tagColors: Record<string, string>;
	/** Whether pills show a remove button on click. */
	removable: boolean;
	/** Called when a tag is removed. Only relevant when removable is true. */
	onRemove?: (tag: string) => void;
}

/** Renders a strip of tag pills with optional remove buttons. */
export class TagPills {
	private containerEl: HTMLElement;
	private config: TagPillsConfig;

	/** Creates a tag pill strip inside the given parent element. */
	constructor(parent: HTMLElement, config: TagPillsConfig) {
		this.config = config;
		this.containerEl = parent.createDiv({ cls: 'vw-pending-tags' });
	}

	/** Re-renders the pill strip with the given tags. */
	update(tags: string[]): void {
		this.containerEl.empty();
		if (tags.length === 0) {
			this.containerEl.style.display = 'none';
			return;
		}
		this.containerEl.style.display = 'flex';

		for (const tag of tags) {
			const pill = this.containerEl.createSpan({
				cls: this.config.removable ? 'vw-tag-pill vw-tag-pill-removable' : 'vw-tag-pill',
				text: tag,
			});

			const color = this.config.tagColors[tag];
			if (color) {
				pill.style.backgroundColor = color;
			}

			if (this.config.removable) {
				const removeIcon = pill.createSpan({ cls: 'vw-tag-pill-x' });
				setIcon(removeIcon, 'x');
				pill.addEventListener('click', () => {
					this.config.onRemove?.(tag);
				});
			}
		}
	}

	/** Removes the container element from the DOM. */
	destroy(): void {
		this.containerEl.remove();
	}
}
