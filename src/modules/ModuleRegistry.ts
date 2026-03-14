/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard
 * Description: Central registry for module renderers -- unifies built-in and external module registration
 * Created: 2026-03-09
 * Last Modified: 2026-03-09
 */

import { ModuleRenderer } from './ModuleCard';

/** Central registry for module renderers. Unifies built-in and external module registration. */
export class ModuleRegistry {
	private renderers = new Map<string, ModuleRenderer>();

	/** Registers a module renderer by id. */
	register(renderer: ModuleRenderer): void {
		this.renderers.set(renderer.id, renderer);
	}

	/** Removes a module renderer by id. */
	unregister(id: string): void {
		this.renderers.delete(id);
	}

	/** Returns the renderer for the given id, or undefined. */
	get(id: string): ModuleRenderer | undefined {
		return this.renderers.get(id);
	}

	/** Returns all registered renderers. */
	getAll(): ModuleRenderer[] {
		return [...this.renderers.values()];
	}

	/** Returns all registered module ids. */
	getRegisteredIds(): string[] {
		return [...this.renderers.keys()];
	}

	/** Returns true if a renderer is registered for the given id. */
	has(id: string): boolean {
		return this.renderers.has(id);
	}
}
