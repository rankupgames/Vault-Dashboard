/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard
 * Description: Contract for renderable dashboard sections (timer, heatmap, tasks, etc)
 * Created: 2026-03-09
 * Last Modified: 2026-03-09
 */

/** Dashboard layout zone where a section can be placed. */
export type SectionZone = 'top-bar' | 'right-col' | 'left-col';

/** Contract for a composable dashboard section rendered by zone and order. */
export interface SectionRenderer {
	/** Unique section identifier. */
	readonly id: string;
	/** Layout zone this section renders into. */
	readonly zone: SectionZone;
	/** Sort order within the zone (lower renders first). */
	readonly order: number;
	/**
	 * Renders the section into the given parent element.
	 * @param parent - Container element
	 */
	render(parent: HTMLElement): void;
	/** Re-renders or refreshes the section in place. */
	update?(): void;
	/** Cleans up subscriptions and DOM references. */
	destroy?(): void;
}
