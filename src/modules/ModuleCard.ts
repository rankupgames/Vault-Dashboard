/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard
 * Description: Composition-based module card that renders chrome (header, collapse, refresh) around a ModuleRenderer
 * Created: 2026-03-07
 * Last Modified: 2026-03-07
 */

import { setIcon } from 'obsidian';
import { ModuleConfig } from '../core/types';

/** Contract for modules that render content inside a ModuleCard. */
export interface ModuleRenderer {
	/** Unique module identifier. */
	readonly id: string;
	/** Display name shown in the card header. */
	readonly name: string;
	/** When true, shows a refresh button in the header. */
	readonly showRefresh?: boolean;
	/** Renders the module body into the given element. */
	renderContent(el: HTMLElement): void;
	/** Optional. Renders custom header action buttons. */
	renderHeaderActions?(actionsEl: HTMLElement): void;
	/** Optional. Cleanup when the module is destroyed. */
	destroy?(): void;
}

/** Card wrapper that provides header, collapse, drag-reorder, and refresh around a ModuleRenderer. */
export class ModuleCard {
	private renderer: ModuleRenderer;
	private config: ModuleConfig;
	private container: HTMLElement | null = null;
	private onCollapseChange: ((id: string, collapsed: boolean) => void) | null = null;
	private onDragReorder: ((fromId: string, toId: string, before: boolean) => void) | null = null;

	constructor(renderer: ModuleRenderer, config: ModuleConfig) {
		this.renderer = renderer;
		this.config = config;
	}

	/** Unique identifier of the wrapped module. */
	get id(): string {
		return this.renderer.id;
	}

	/** Returns a shallow copy of the module config. */
	getConfig(): ModuleConfig {
		return { ...this.config };
	}

	/** Sets the collapsed state without triggering callbacks. */
	setCollapsed(collapsed: boolean): void {
		this.config.collapsed = collapsed;
	}

	/** Registers a callback invoked when the user toggles collapse. */
	onCollapseChanged(cb: (id: string, collapsed: boolean) => void): void {
		this.onCollapseChange = cb;
	}

	/** Registers a callback invoked when the user drag-reorders this card. */
	onDragReordered(cb: (fromId: string, toId: string, before: boolean) => void): void {
		this.onDragReorder = cb;
	}

	/** Returns the root DOM element of the card, or null if not yet rendered. */
	getContainer(): HTMLElement | null {
		return this.container;
	}

	/** Renders the card into the parent element. */
	render(parent: HTMLElement): void {
		this.container = parent.createDiv({ cls: 'vw-module-card' });
		this.container.dataset.moduleId = this.renderer.id;

		if (this.config.collapsed) {
			this.container.addClass('vw-module-collapsed');
		}

		const header = this.container.createDiv({ cls: 'vw-module-header' });

		this.setupModuleDrag(header);

		header.createDiv({ cls: 'vw-module-title', text: this.renderer.name });

		const actions = header.createDiv({ cls: 'vw-module-header-actions' });

		if (this.renderer.renderHeaderActions) {
			this.renderer.renderHeaderActions(actions);
		} else if (this.renderer.showRefresh) {
			const refreshBtn = actions.createDiv({ cls: 'vw-module-refresh' });
			setIcon(refreshBtn, 'refresh-cw');
			refreshBtn.setAttribute('aria-label', 'Refresh');
			refreshBtn.setAttribute('tabindex', '0');
			refreshBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				this.refresh();
			});
		}

		const collapseBtn = actions.createDiv({ cls: 'vw-module-collapse' });
		setIcon(collapseBtn, this.config.collapsed ? 'chevron-right' : 'chevron-down');

		header.addEventListener('click', () => {
			this.config.collapsed = this.config.collapsed === false;
			this.updateCollapseState(collapseBtn);
			if (this.onCollapseChange) {
				this.onCollapseChange(this.renderer.id, this.config.collapsed);
			}
		});

		const body = this.container.createDiv({ cls: 'vw-module-body' });
		if (this.config.collapsed) {
			body.style.display = 'none';
		}

		this.renderer.renderContent(body);
	}

	/** Re-renders the module body content. */
	refresh(): void {
		if (this.container === null) return;
		const body = this.container.querySelector('.vw-module-body') as HTMLElement | null;
		if (body === null) return;
		body.empty();
		this.renderer.renderContent(body);
	}

	/** Destroys the card, calls renderer destroy, and removes DOM. */
	destroy(): void {
		this.renderer.destroy?.();
		if (this.container) {
			this.container.remove();
			this.container = null;
		}
	}

	/** Wires drag-start/end handlers on the header for module reordering. */
	private setupModuleDrag(header: HTMLElement): void {
		const card = this.container!;
		const moduleId = this.renderer.id;

		header.addEventListener('mousedown', () => {
			card.setAttribute('draggable', 'true');
		});

		header.addEventListener('mouseup', () => {
			card.removeAttribute('draggable');
		});

		card.addEventListener('dragstart', (e: DragEvent) => {
			if (card.getAttribute('draggable') !== 'true') { e.preventDefault(); return; }
			card.addClass('vw-dragging');
			e.dataTransfer?.setData('text/plain', moduleId);
			if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
			ModuleCard.draggedModuleId = moduleId;

			const ownerDoc = card.doc;
			const preview = ownerDoc.createElement('div');
			preview.className = 'vw-drag-preview';
			preview.textContent = this.renderer.name;
			ownerDoc.body.appendChild(preview);
			e.dataTransfer?.setDragImage(preview, preview.offsetWidth / 2, preview.offsetHeight / 2);
			requestAnimationFrame(() => preview.remove());

			ownerDoc.querySelectorAll('.vw-module-remove-zone').forEach((z) => z.classList.add('vw-module-remove-zone-visible'));
		});

		card.addEventListener('dragend', () => {
			ModuleCard.draggedModuleId = null;
			card.removeClass('vw-dragging');
			card.removeAttribute('draggable');
			card.parentElement?.querySelectorAll('.vw-drag-above, .vw-drag-below').forEach((el) => {
				el.classList.remove('vw-drag-above', 'vw-drag-below');
			});
			card.doc.querySelectorAll('.vw-module-remove-zone').forEach((z) => z.classList.remove('vw-module-remove-zone-visible', 'vw-module-remove-zone-over'));
		});

		card.addEventListener('dragover', (e: DragEvent) => {
			if (ModuleCard.draggedModuleId === null || ModuleCard.draggedModuleId === moduleId) return;
			e.preventDefault();
			if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
			const rect = card.getBoundingClientRect();
			const above = e.clientY < rect.top + rect.height / 2;
			card.toggleClass('vw-drag-above', above);
			card.toggleClass('vw-drag-below', above === false);
		});

		card.addEventListener('dragleave', () => {
			card.removeClass('vw-drag-above');
			card.removeClass('vw-drag-below');
		});

		card.addEventListener('drop', (e: DragEvent) => {
			e.preventDefault();
			card.removeClass('vw-drag-above');
			card.removeClass('vw-drag-below');
			if (ModuleCard.draggedModuleId === null || ModuleCard.draggedModuleId === moduleId) return;
			const rect = card.getBoundingClientRect();
			const before = e.clientY < rect.top + rect.height / 2;
			if (this.onDragReorder) {
				this.onDragReorder(ModuleCard.draggedModuleId, moduleId, before);
			}
			ModuleCard.draggedModuleId = null;
		});
	}

	/** ID of the module currently being dragged, or null. */
	static draggedModuleId: string | null = null;

	/** Syncs the card body visibility and button icon with the collapsed flag. */
	private updateCollapseState(btn: HTMLElement): void {
		if (this.container === null) return;
		const body = this.container.querySelector('.vw-module-body') as HTMLElement | null;
		if (body === null) return;

		if (this.config.collapsed) {
			body.style.display = 'none';
			this.container.addClass('vw-module-collapsed');
			setIcon(btn, 'chevron-right');
		} else {
			body.style.display = '';
			this.container.removeClass('vw-module-collapsed');
			setIcon(btn, 'chevron-down');
		}
	}
}
