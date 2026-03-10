import { describe, it, expect } from 'vitest';
import { hexToHsl, generateHeatmapShades, generateBranchShades } from '../../src/core/ColorUtils';

describe('hexToHsl', () => {
	it('converts pure red', () => {
		const [h, s, l] = hexToHsl('#ff0000');
		expect(h).toBeCloseTo(0, 0);
		expect(s).toBeCloseTo(100, 0);
		expect(l).toBeCloseTo(50, 0);
	});

	it('converts pure green', () => {
		const [h, s, l] = hexToHsl('#00ff00');
		expect(h).toBeCloseTo(120, 0);
		expect(s).toBeCloseTo(100, 0);
		expect(l).toBeCloseTo(50, 0);
	});

	it('converts pure blue', () => {
		const [h, s, l] = hexToHsl('#0000ff');
		expect(h).toBeCloseTo(240, 0);
		expect(s).toBeCloseTo(100, 0);
		expect(l).toBeCloseTo(50, 0);
	});

	it('converts white to zero saturation', () => {
		const [h, s, l] = hexToHsl('#ffffff');
		expect(s).toBe(0);
		expect(l).toBeCloseTo(100, 0);
	});

	it('converts black to zero saturation and lightness', () => {
		const [h, s, l] = hexToHsl('#000000');
		expect(s).toBe(0);
		expect(l).toBe(0);
	});

	it('converts a mid-range color', () => {
		const [h, s, l] = hexToHsl('#39d353');
		expect(h).toBeGreaterThan(100);
		expect(h).toBeLessThan(140);
		expect(s).toBeGreaterThan(50);
		expect(l).toBeGreaterThan(30);
		expect(l).toBeLessThan(70);
	});
});

describe('generateHeatmapShades', () => {
	it('returns exactly 4 hex strings', () => {
		const shades = generateHeatmapShades('#39d353');
		expect(shades).toHaveLength(4);
		for (const shade of shades) {
			expect(shade).toMatch(/^#[0-9a-f]{6}$/);
		}
	});

	it('produces shades with ascending lightness', () => {
		const shades = generateHeatmapShades('#39d353');
		const lightnesses = shades.map((s) => hexToHsl(s)[2]);

		for (let i = 1; i < lightnesses.length; i++) {
			expect(lightnesses[i]).toBeGreaterThan(lightnesses[i - 1]);
		}
	});

	it('works with achromatic input', () => {
		const shades = generateHeatmapShades('#808080');
		expect(shades).toHaveLength(4);
	});
});

describe('generateBranchShades', () => {
	it('returns exactly 4 hex strings', () => {
		const shades = generateBranchShades('#6366f1');
		expect(shades).toHaveLength(4);
		for (const shade of shades) {
			expect(shade).toMatch(/^#[0-9a-f]{6}$/);
		}
	});

	it('first shade matches input color', () => {
		const input = '#6366f1';
		const shades = generateBranchShades(input);
		expect(shades[0]).toBe(input);
	});

	it('produces shades with descending lightness', () => {
		const shades = generateBranchShades('#6366f1');
		const lightnesses = shades.map((s) => hexToHsl(s)[2]);

		for (let i = 1; i < lightnesses.length; i++) {
			expect(lightnesses[i]).toBeLessThanOrEqual(lightnesses[i - 1]);
		}
	});
});
