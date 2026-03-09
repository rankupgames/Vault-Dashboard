/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard Welcome
 * Description: Composition-based module card that renders chrome (header, collapse, refresh) around a ModuleRenderer
 * Created: 2026-03-07
 * Last Modified: 2026-03-07
 */

import { setIcon } from 'obsidian';
import { ModuleConfig } from '../types';

export interface ModuleRenderer {
	readonly id: string;
	readonly name: string;
	readonly showRefresh?: boolean;
	renderContent(el: HTMLElement): void;
	renderHeaderActions?(actionsEl: HTMLElement): void;
	destroy?(): void;
}

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

	get id(): string {
		return this.renderer.id;
	}

	getConfig(): ModuleConfig {
		return { ...this.config };
	}

	setCollapsed(collapsed: boolean): void {
		this.config.collapsed = collapsed;
	}

	onCollapseChanged(cb: (id: string, collapsed: boolean) => void): void {
		this.onCollapseChange = cb;
	}

	onDragReordered(cb: (fromId: string, toId: string, before: boolean) => void): void {
		this.onDragReorder = cb;
	}

	getContainer(): HTMLElement | null {
		return this.container;
	}

	render(parent: HTMLElement): void {
		this.container = parent.createDiv({ cls: 'vw-module-card' });
		this.container.dataset.moduleId = this.renderer.id;

		if (this.config.collapsed) {
			this.container.addClass('vw-module-collapsed');
		}

		const header = this.container.createDiv({ cls: 'vw-module-header' });

		const dragHandle = header.createDiv({ cls: 'vw-drag-handle vw-module-drag-handle' });
		setIcon(dragHandle, 'grip-vertical');

		this.setupModuleDrag(dragHandle);

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

	refresh(): void {
		if (this.container === null) return;
		const body = this.container.querySelector('.vw-module-body') as HTMLElement | null;
		if (body === null) return;
		body.empty();
		this.renderer.renderContent(body);
	}

	destroy(): void {
		this.renderer.destroy?.();
		if (this.container) {
			this.container.remove();
			this.container = null;
		}
	}

	private setupModuleDrag(handle: HTMLElement): void {
		const card = this.container!;
		const moduleId = this.renderer.id;

		handle.addEventListener('mousedown', (e) => {
			e.stopPropagation();
			card.setAttribute('draggable', 'true');
		});

		card.addEventListener('dragstart', (e: DragEvent) => {
			if (card.getAttribute('draggable') !== 'true') { e.preventDefault(); return; }
			card.addClass('vw-dragging');
			e.dataTransfer?.setData('text/plain', moduleId);
			if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
			ModuleCard.draggedModuleId = moduleId;

			const preview = document.createElement('div');
			preview.className = 'vw-drag-preview';
			preview.textContent = this.renderer.name;
			document.body.appendChild(preview);
			e.dataTransfer?.setDragImage(preview, preview.offsetWidth / 2, preview.offsetHeight / 2);
			requestAnimationFrame(() => preview.remove());

			document.querySelectorAll('.vw-module-remove-zone').forEach((z) => z.classList.add('vw-module-remove-zone-visible'));
		});

		card.addEventListener('dragend', () => {
			ModuleCard.draggedModuleId = null;
			card.removeClass('vw-dragging');
			card.removeAttribute('draggable');
			card.parentElement?.querySelectorAll('.vw-drag-above, .vw-drag-below').forEach((el) => {
				el.classList.remove('vw-drag-above', 'vw-drag-below');
			});
			document.querySelectorAll('.vw-module-remove-zone').forEach((z) => z.classList.remove('vw-module-remove-zone-visible', 'vw-module-remove-zone-over'));
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

	static draggedModuleId: string | null = null;

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
