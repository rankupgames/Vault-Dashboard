import { describe, expect, it } from 'vitest';
import { TaskParser } from '../../src/services/TaskParser';

describe('TaskParser source metadata', () => {
	it('preserves top-level status and exact source lines', () => {
		const items = TaskParser.parseLines([
			'# Plan',
			'- [ ] First task',
			'  - [ ] Nested task',
			'- [X] Completed task',
		]);

		expect(items).toHaveLength(2);
		expect(items[0]).toMatchObject({ title: 'First task', status: 'pending', line: 2 });
		expect(items[0].subtasks[0]).toMatchObject({ title: 'Nested task', status: 'pending' });
		expect(items[1]).toMatchObject({ title: 'Completed task', status: 'completed', line: 4 });
	});

	it('keeps duplicate checklist titles as distinct source lines', () => {
		const items = TaskParser.parseLines([
			'- [ ] Repeat',
			'- [ ] Repeat',
		]);

		expect(items.map((item) => item.line)).toEqual([1, 2]);
	});
});
