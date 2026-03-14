/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard
 * Description: Composable SVG ring factory for circular timer progress indicators
 * Created: 2026-03-11
 * Last Modified: 2026-03-11
 */

/** Configuration for creating a timer ring. */
export interface TimerRingConfig {
	/** ViewBox and element dimension in px (e.g. 80 for the dashboard, 56 for mini). */
	size: number;
	/** Circle radius in SVG units. */
	radius: number;
	/** Ring stroke width (defaults to 3). */
	strokeWidth?: number;
	/** CSS class applied to the background circle. */
	bgClass: string;
	/** CSS class applied to the progress circle. */
	ringClass: string;
	/** CSS class toggled on the progress circle when the timer is negative. */
	negativeClass: string;
}

/** Handle returned by `createTimerRing` for reading and updating the ring. */
export interface TimerRingHandle {
	svg: SVGSVGElement;
	ring: SVGCircleElement;
	circumference: number;
	/** Set stroke offset and negative styling in one call. */
	update(progress: number, isNegative: boolean): void;
}

/**
 * Creates an SVG ring with a background track and a progress arc inside `parent`.
 * Returns a handle with the ring element and an `update` function.
 */
export const createTimerRing = (parent: HTMLElement, config: TimerRingConfig): TimerRingHandle => {
	const { size, radius, bgClass, ringClass, negativeClass } = config;
	const strokeWidth = config.strokeWidth ?? 3;
	const circumference = 2 * Math.PI * radius;
	const center = size / 2;

	const svg = parent.createSvg('svg');
	svg.setAttribute('viewBox', `0 0 ${size} ${size}`);

	const bg = svg.createSvg('circle');
	bg.setAttribute('cx', String(center));
	bg.setAttribute('cy', String(center));
	bg.setAttribute('r', String(radius));
	bg.setAttribute('class', bgClass);
	bg.style.strokeWidth = String(strokeWidth);

	const ring = svg.createSvg('circle');
	ring.setAttribute('cx', String(center));
	ring.setAttribute('cy', String(center));
	ring.setAttribute('r', String(radius));
	ring.setAttribute('class', ringClass);
	ring.style.strokeWidth = String(strokeWidth);
	ring.style.strokeDasharray = String(circumference);
	ring.style.strokeDashoffset = String(circumference);

	const update = (progress: number, isNegative: boolean): void => {
		ring.style.strokeDashoffset = String(circumference * progress);
		ring.toggleClass(negativeClass, isNegative);
	};

	return { svg, ring, circumference, update };
};
