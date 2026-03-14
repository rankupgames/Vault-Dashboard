/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard Welcome
 * Description: Color conversion utilities and gradient shade generators for heatmap and branch colors
 * Created: 2026-03-08
 * Last Modified: 2026-03-08
 */

/** Parses a hex color string into an [R, G, B] tuple (0-255). */
const hexToRgb = (hex: string): [number, number, number] => {
	const h = hex.replace('#', '');
	return [
		parseInt(h.substring(0, 2), 16),
		parseInt(h.substring(2, 4), 16),
		parseInt(h.substring(4, 6), 16),
	];
};

/** Converts RGB values (0-255) to HSL [h 0-360, s 0-100, l 0-100]. */
const rgbToHsl = (r: number, g: number, b: number): [number, number, number] => {
	r /= 255;
	g /= 255;
	b /= 255;
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const l = (max + min) / 2;

	if (max === min) return [0, 0, l * 100];

	const d = max - min;
	const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
	let h: number;
	if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
	else if (max === g) h = ((b - r) / d + 2) / 6;
	else h = ((r - g) / d + 4) / 6;

	return [h * 360, s * 100, l * 100];
};

/** Converts HSL [h 0-360, s 0-100, l 0-100] to a hex color string. */
const hslToHex = (h: number, s: number, l: number): string => {
	h /= 360;
	s /= 100;
	l /= 100;

	if (s === 0) {
		const v = Math.round(l * 255).toString(16).padStart(2, '0');
		return `#${v}${v}${v}`;
	}

	const hue2rgb = (p: number, q: number, t: number): number => {
		if (t < 0) t += 1;
		if (t > 1) t -= 1;
		if (t < 1 / 6) return p + (q - p) * 6 * t;
		if (t < 1 / 2) return q;
		if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
		return p;
	};

	const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
	const p = 2 * l - q;
	const r = hue2rgb(p, q, h + 1 / 3);
	const g = hue2rgb(p, q, h);
	const b = hue2rgb(p, q, h - 1 / 3);

	const toHex = (x: number): string => Math.round(x * 255).toString(16).padStart(2, '0');
	return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

/**
 * Converts a hex color to HSL.
 * @param hex - Color in hex format (e.g. #39d353)
 * @returns [h, s, l] with h 0-360, s and l 0-100
 */
export const hexToHsl = (hex: string): [number, number, number] => {
	const [r, g, b] = hexToRgb(hex);
	return rgbToHsl(r, g, b);
};

/**
 * Generates 4 intensity levels for a heatmap from a single base color.
 * Level 1 is the dimmest, level 4 is closest to the picked color.
 * @param hex - Base color in hex format
 * @returns Tuple of 4 hex colors
 */
export const generateHeatmapShades = (hex: string): [string, string, string, string] => {
	const [h, s] = hexToHsl(hex);
	return [
		hslToHex(h, Math.min(s, 60), 25),
		hslToHex(h, Math.min(s, 70), 35),
		hslToHex(h, Math.min(s, 78), 46),
		hslToHex(h, Math.min(s, 85), 58),
	];
};

/**
 * Generates 4 depth shades for the task tree from a single base color.
 * Depth 0 is the brightest (picked color), deeper levels get progressively dimmer.
 * @param hex - Base color in hex format
 * @returns Tuple of 4 hex colors
 */
export const generateBranchShades = (hex: string): [string, string, string, string] => {
	const [h, s, l] = hexToHsl(hex);
	return [
		hex,
		hslToHex(h, Math.max(s - 8, 25), Math.max(l - 10, 28)),
		hslToHex(h, Math.max(s - 16, 20), Math.max(l - 20, 23)),
		hslToHex(h, Math.max(s - 24, 15), Math.max(l - 30, 18)),
	];
};
