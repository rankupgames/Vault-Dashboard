import { describe, it, expect } from 'vitest';
import { IMAGE_EXTENSIONS, isImageExtension } from '../../src/core/types';

describe('IMAGE_EXTENSIONS', () => {
	it('contains expected formats', () => {
		expect(IMAGE_EXTENSIONS).toContain('png');
		expect(IMAGE_EXTENSIONS).toContain('jpg');
		expect(IMAGE_EXTENSIONS).toContain('jpeg');
		expect(IMAGE_EXTENSIONS).toContain('gif');
		expect(IMAGE_EXTENSIONS).toContain('svg');
		expect(IMAGE_EXTENSIONS).toContain('webp');
	});

	it('has exactly 6 supported formats', () => {
		expect(IMAGE_EXTENSIONS).toHaveLength(6);
	});
});

describe('isImageExtension', () => {
	it('returns true for known image extensions', () => {
		expect(isImageExtension('png')).toBe(true);
		expect(isImageExtension('jpg')).toBe(true);
		expect(isImageExtension('jpeg')).toBe(true);
		expect(isImageExtension('gif')).toBe(true);
		expect(isImageExtension('svg')).toBe(true);
		expect(isImageExtension('webp')).toBe(true);
	});

	it('is case-insensitive', () => {
		expect(isImageExtension('PNG')).toBe(true);
		expect(isImageExtension('Jpg')).toBe(true);
		expect(isImageExtension('WEBP')).toBe(true);
	});

	it('returns false for non-image extensions', () => {
		expect(isImageExtension('md')).toBe(false);
		expect(isImageExtension('txt')).toBe(false);
		expect(isImageExtension('pdf')).toBe(false);
		expect(isImageExtension('ts')).toBe(false);
		expect(isImageExtension('')).toBe(false);
	});
});
