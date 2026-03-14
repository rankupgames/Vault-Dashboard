/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard
 * Description: Module registry and layout manager using composition-based ModuleCard
 * Created: 2026-03-07
 * Last Modified: 2026-03-07
 */

import { ModuleConfig } from '../core/types';
import { ModuleCard, ModuleRenderer } from './ModuleCard';

/** Manages a grid of ModuleCards with config-driven order, collapse, and drag-reorder. */
export class ModuleContainer {
	private container: HTMLElement;
	private cards: ModuleCard[] = [];
	private configs: ModuleConfig[];
	private onReorder: ((configs: ModuleConfig[]) => void) | null = null;
	private onCollapse: (() => void) | null = null;

	/** Creates the module container with a DOM element and module configs. */
	constructor(container: HTMLElement, configs: ModuleConfig[]) {
		this.container = container;
		this.configs = configs;
	}

	/** Sets the callback invoked when modules are drag-reordered. */
	onReorderCallback(cb: (configs: ModuleConfig[]) => void): void {
		this.onReorder = cb;
	}

	/** Sets the callback invoked when a module's collapse state changes. */
	onCollapseCallback(cb: () => void): void {
		this.onCollapse = cb;
	}

	/** Registers a module renderer and creates its ModuleCard. */
	registerModule(renderer: ModuleRenderer): void {
		const config = this.configs.find((c) => c.id === renderer.id) ?? {
			id: renderer.id,
			name: renderer.name,
			enabled: true,
			order: 99,
			collapsed: false,
		};
		this.cards.push(new ModuleCard(renderer, config));
	}

	/** Renders all enabled modules in order into the container. */
	render(): void {
		this.container.empty();
		this.container.addClass('vw-module-container');

		const grid = this.container.createDiv({ cls: 'vw-module-grid' });

		const sorted = this.getEnabledCards();
		for (const card of sorted) {
			card.onCollapseChanged(() => {
				if (this.onCollapse) this.onCollapse();
			});
			card.onDragReordered((fromId, toId, before) => {
				this.handleReorder(fromId, toId, before);
			});
			card.render(grid);
		}
	}

	/** Reorders module configs after a drag-drop and triggers a re-render. */
	private handleReorder(fromId: string, toId: string, before: boolean): void {
		const fromIdx = this.configs.findIndex((c) => c.id === fromId);
		const toIdx = this.configs.findIndex((c) => c.id === toId);
		if (fromIdx === -1 || toIdx === -1) return;

		const [moved] = this.configs.splice(fromIdx, 1);
		const newToIdx = this.configs.findIndex((c) => c.id === toId);
		const insertAt = before ? newToIdx : newToIdx + 1;
		this.configs.splice(insertAt, 0, moved);

		this.configs.forEach((c, i) => { c.order = i; });

		if (this.onReorder) {
			this.onReorder(this.configs.map((c) => ({ ...c })));
		}

		this.render();
	}

	/** Refreshes all enabled module cards. */
	refreshAll(): void {
		for (const card of this.cards) {
			if (card.getConfig().enabled) {
				card.refresh();
			}
		}
	}

	/** Destroys all module cards and clears the container. */
	destroy(): void {
		for (const card of this.cards) {
			card.destroy();
		}
		this.cards = [];
	}

	/** Returns config snapshots for all registered modules. */
	getConfigs(): ModuleConfig[] {
		return this.cards.map((c) => c.getConfig());
	}

	/** Returns module cards that are enabled, sorted by their config order. */
	private getEnabledCards(): ModuleCard[] {
		return this.cards
			.filter((c) => {
				const cfg = this.configs.find((conf) => conf.id === c.id);
				return cfg ? cfg.enabled : true;
			})
			.sort((a, b) => {
				const ac = this.configs.find((conf) => conf.id === a.id);
				const bc = this.configs.find((conf) => conf.id === b.id);
				return (ac?.order ?? 99) - (bc?.order ?? 99);
			});
	}
}
