import { describe, it, expect, beforeEach } from 'vitest';
import { TaskManager } from '../../src/core/TaskManager';
import { Task, PluginSettings, DEFAULT_SETTINGS } from '../../src/core/types';

const makeSettings = (): PluginSettings => JSON.parse(JSON.stringify(DEFAULT_SETTINGS));

describe('TaskManager', () => {
	let mgr: TaskManager;

	beforeEach(() => {
		mgr = new TaskManager([], [], makeSettings());
	});

	describe('CRUD', () => {
		it('adds a task with auto-incrementing order', () => {
			const a = mgr.addTask('Alpha', 30);
			const b = mgr.addTask('Beta', 15);

			expect(a.order).toBe(0);
			expect(b.order).toBe(1);
			expect(mgr.getTasks()).toHaveLength(2);
		});

		it('getTask returns undefined for missing IDs', () => {
			expect(mgr.getTask('nonexistent')).toBeUndefined();
		});

		it('updateTask modifies the task in place', () => {
			const task = mgr.addTask('Original', 30);
			mgr.updateTask(task.id, { title: 'Updated', durationMinutes: 60 });

			const updated = mgr.getTask(task.id);
			expect(updated?.title).toBe('Updated');
			expect(updated?.durationMinutes).toBe(60);
		});

		it('removeTask deletes by ID', () => {
			const task = mgr.addTask('Delete Me', 10);
			mgr.removeTask(task.id);

			expect(mgr.getTasks()).toHaveLength(0);
			expect(mgr.getTask(task.id)).toBeUndefined();
		});

		it('removeTask is a no-op for unknown IDs', () => {
			mgr.addTask('Stay', 10);
			mgr.removeTask('fake');
			expect(mgr.getTasks()).toHaveLength(1);
		});
	});

	describe('status transitions', () => {
		it('starts as pending and transitions to active', () => {
			const task = mgr.addTask('Work', 30);
			expect(task.status).toBe('pending');

			mgr.startTask(task.id, 0);
			expect(mgr.getTask(task.id)?.status).toBe('active');
		});

		it('startTask records rollover applied', () => {
			const task = mgr.addTask('Work', 30);
			mgr.startTask(task.id, 5);
			expect(mgr.getTask(task.id)?.rolloverApplied).toBe(5);
		});

		it('startTask ignores non-pending tasks', () => {
			const task = mgr.addTask('Work', 30);
			mgr.startTask(task.id, 0);
			mgr.completeTask(task.id);

			mgr.startTask(task.id, 0);
			expect(mgr.getTask(task.id)?.status).toBe('completed');
		});

		it('completeTask sets status and timestamps', () => {
			const task = mgr.addTask('Work', 30);
			mgr.startTask(task.id, 0);
			mgr.completeTask(task.id);

			const completed = mgr.getTask(task.id)!;
			expect(completed.status).toBe('completed');
			expect(completed.completedAt).toBeDefined();
		});

		it('completeTask marks all subtasks completed', () => {
			const task = mgr.addTask('Parent', 30);
			mgr.addSubTask(task.id, 'Child A');
			mgr.addSubTask(task.id, 'Child B');

			mgr.startTask(task.id, 0);
			mgr.completeTask(task.id);

			const completed = mgr.getTask(task.id)!;
			for (const sub of completed.subtasks ?? []) {
				expect(sub.status).toBe('completed');
			}
		});

		it('skipTask sets status to skipped', () => {
			const task = mgr.addTask('Skip', 30);
			mgr.skipTask(task.id);
			expect(mgr.getTask(task.id)?.status).toBe('skipped');
		});

		it('uncompleteTask reverts to pending', () => {
			const task = mgr.addTask('Work', 30);
			mgr.startTask(task.id, 0);
			mgr.completeTask(task.id);
			mgr.uncompleteTask(task.id);

			const reverted = mgr.getTask(task.id)!;
			expect(reverted.status).toBe('pending');
			expect(reverted.completedAt).toBeUndefined();
			expect(reverted.startedAt).toBeUndefined();
		});

		it('resetToPending clears timing data', () => {
			const task = mgr.addTask('Work', 30);
			mgr.startTask(task.id, 5);
			mgr.resetToPending(task.id);

			const reset = mgr.getTask(task.id)!;
			expect(reset.status).toBe('pending');
			expect(reset.startedAt).toBeUndefined();
			expect(reset.rolloverApplied).toBeUndefined();
		});
	});

	describe('ordering', () => {
		it('getTasks returns sorted by order', () => {
			mgr.addTask('C', 10);
			mgr.addTask('A', 10);
			mgr.addTask('B', 10);

			const tasks = mgr.getTasks();
			expect(tasks[0].title).toBe('C');
			expect(tasks[1].title).toBe('A');
			expect(tasks[2].title).toBe('B');
		});

		it('moveToFront places task at lowest order', () => {
			const a = mgr.addTask('First', 10);
			mgr.addTask('Second', 10);
			const c = mgr.addTask('Third', 10);

			mgr.moveToFront(c.id);
			expect(mgr.getTasks()[0].id).toBe(c.id);
		});

		it('reorder swaps adjacent tasks', () => {
			const a = mgr.addTask('A', 10);
			const b = mgr.addTask('B', 10);

			mgr.reorder(b.id, 'up');
			const tasks = mgr.getTasks();
			expect(tasks[0].id).toBe(b.id);
			expect(tasks[1].id).toBe(a.id);
		});

		it('moveTask repositions before target', () => {
			const a = mgr.addTask('A', 10);
			const b = mgr.addTask('B', 10);
			const c = mgr.addTask('C', 10);

			mgr.moveTask(c.id, a.id, true);
			const ids = mgr.getTasks().map((t) => t.id);
			expect(ids).toEqual([c.id, a.id, b.id]);
		});
	});

	describe('archive', () => {
		it('archiveCompleted moves done tasks out of active list', () => {
			const task = mgr.addTask('Done', 10);
			mgr.addTask('Pending', 10);
			mgr.completeTask(task.id);

			mgr.archiveCompleted();

			expect(mgr.getTasks()).toHaveLength(1);
			expect(mgr.getArchivedTasks()).toHaveLength(1);
			expect(mgr.getArchivedTasks()[0].id).toBe(task.id);
		});

		it('restoreFromArchive puts task back as pending', () => {
			const task = mgr.addTask('Restore Me', 10);
			mgr.completeTask(task.id);
			mgr.archiveCompleted();

			mgr.restoreFromArchive(task.id);

			expect(mgr.getArchivedTasks()).toHaveLength(0);
			const restored = mgr.getTask(task.id)!;
			expect(restored.status).toBe('pending');
		});

		it('deleteArchivedTask permanently removes from archive', () => {
			const task = mgr.addTask('Gone', 10);
			mgr.completeTask(task.id);
			mgr.archiveCompleted();

			mgr.deleteArchivedTask(task.id);
			expect(mgr.getArchivedTasks()).toHaveLength(0);
		});

		it('clearArchive empties the archive', () => {
			const a = mgr.addTask('A', 10);
			const b = mgr.addTask('B', 10);
			mgr.completeTask(a.id);
			mgr.completeTask(b.id);
			mgr.archiveCompleted();

			mgr.clearArchive();
			expect(mgr.getArchivedTasks()).toHaveLength(0);
		});

		it('autoArchiveStale archives tasks older than threshold', () => {
			const task = mgr.addTask('Old', 10);
			mgr.completeTask(task.id);

			const t = mgr.getTask(task.id)!;
			t.completedAt = Date.now() - 4 * 24 * 60 * 60 * 1000;

			mgr.autoArchiveStale(3);

			expect(mgr.getTasks()).toHaveLength(0);
			expect(mgr.getArchivedTasks()).toHaveLength(1);
		});

		it('autoArchiveStale ignores tasks within threshold', () => {
			const task = mgr.addTask('Recent', 10);
			mgr.completeTask(task.id);

			mgr.autoArchiveStale(3);

			expect(mgr.getTasks()).toHaveLength(1);
			expect(mgr.getArchivedTasks()).toHaveLength(0);
		});
	});

	describe('subtasks', () => {
		it('adds subtasks under a task', () => {
			const task = mgr.addTask('Parent', 30);
			const sub = mgr.addSubTask(task.id, 'Child');

			expect(sub).toBeDefined();
			expect(mgr.getTask(task.id)?.subtasks).toHaveLength(1);
		});

		it('enforces max depth of 4', () => {
			const task = mgr.addTask('Deep', 30);
			const s1 = mgr.addSubTask(task.id, 'L1')!;
			const s2 = mgr.addSubTask(task.id, 'L2', [s1.id])!;
			const s3 = mgr.addSubTask(task.id, 'L3', [s1.id, s2.id])!;
			const s4 = mgr.addSubTask(task.id, 'L4', [s1.id, s2.id, s3.id]);

			expect(s4).toBeDefined();

			const s5 = mgr.addSubTask(task.id, 'L5', [s1.id, s2.id, s3.id, s4!.id]);
			expect(s5).toBeUndefined();
		});

		it('toggleSubTask flips between pending and completed', () => {
			const task = mgr.addTask('Parent', 30);
			const sub = mgr.addSubTask(task.id, 'Toggle Me')!;

			mgr.toggleSubTask(task.id, [sub.id]);
			expect(mgr.getTask(task.id)?.subtasks?.[0].status).toBe('completed');

			mgr.toggleSubTask(task.id, [sub.id]);
			expect(mgr.getTask(task.id)?.subtasks?.[0].status).toBe('pending');
		});

		it('removeSubTask deletes a subtask', () => {
			const task = mgr.addTask('Parent', 30);
			const sub = mgr.addSubTask(task.id, 'Remove Me')!;

			mgr.removeSubTask(task.id, [sub.id]);
			expect(mgr.getTask(task.id)?.subtasks).toBeUndefined();
		});

		it('renameSubTask updates the title', () => {
			const task = mgr.addTask('Parent', 30);
			const sub = mgr.addSubTask(task.id, 'Old Name')!;

			mgr.renameSubTask(task.id, [sub.id], 'New Name');
			expect(mgr.getTask(task.id)?.subtasks?.[0].title).toBe('New Name');
		});
	});

	describe('tags', () => {
		it('adds tasks with tags', () => {
			const task = mgr.addTask('Tagged', 10, ['urgent', 'bug']);
			expect(task.tags).toEqual(['urgent', 'bug']);
		});

		it('getTaggedTasks filters by tag', () => {
			mgr.addTask('A', 10, ['work']);
			mgr.addTask('B', 10, ['personal']);
			mgr.addTask('C', 10, ['work', 'personal']);

			expect(mgr.getTaggedTasks('work')).toHaveLength(2);
			expect(mgr.getTaggedTasks('personal')).toHaveLength(2);
		});

		it('getAllTags returns sorted unique tags', () => {
			mgr.addTask('A', 10, ['beta', 'alpha']);
			mgr.addTask('B', 10, ['alpha', 'gamma']);

			expect(mgr.getAllTags()).toEqual(['alpha', 'beta', 'gamma']);
		});
	});

	describe('undo / redo', () => {
		it('undo reverts addTask', () => {
			mgr.addTask('Keep', 10);
			mgr.addTask('Remove', 10);
			expect(mgr.getTasks()).toHaveLength(2);

			mgr.undo();
			expect(mgr.getTasks()).toHaveLength(1);
			expect(mgr.getTasks()[0].title).toBe('Keep');
		});

		it('redo restores undone action', () => {
			mgr.addTask('A', 10);
			mgr.addTask('B', 10);

			mgr.undo();
			expect(mgr.getTasks()).toHaveLength(1);

			mgr.redo();
			expect(mgr.getTasks()).toHaveLength(2);
		});

		it('undo reverts removeTask', () => {
			const task = mgr.addTask('Recoverable', 10);
			mgr.removeTask(task.id);
			expect(mgr.getTasks()).toHaveLength(0);

			mgr.undo();
			expect(mgr.getTasks()).toHaveLength(1);
		});
	});

	describe('linked docs', () => {
		it('adds and removes linked documents', () => {
			const task = mgr.addTask('Docs', 10);

			mgr.addLinkedDoc(task.id, 'notes/spec.md');
			expect(mgr.getTask(task.id)?.linkedDocs).toEqual(['notes/spec.md']);

			mgr.addLinkedDoc(task.id, 'notes/spec.md');
			expect(mgr.getTask(task.id)?.linkedDocs).toHaveLength(1);

			mgr.removeLinkedDoc(task.id, 'notes/spec.md');
			expect(mgr.getTask(task.id)?.linkedDocs).toBeUndefined();
		});
	});

	describe('workingDirectory', () => {
		it('updateTask sets workingDirectory', () => {
			const task = mgr.addTask('AI Task', 30);
			mgr.updateTask(task.id, { workingDirectory: '/Users/dev/project' });

			expect(mgr.getTask(task.id)?.workingDirectory).toBe('/Users/dev/project');
		});

		it('updateTask clears workingDirectory with undefined', () => {
			const task = mgr.addTask('AI Task', 30);
			mgr.updateTask(task.id, { workingDirectory: '/tmp' });
			mgr.updateTask(task.id, { workingDirectory: undefined });

			expect(mgr.getTask(task.id)?.workingDirectory).toBeUndefined();
		});

		it('workingDirectory survives archive and restore', () => {
			const task = mgr.addTask('Archivable', 10);
			mgr.updateTask(task.id, { workingDirectory: '/projects/my-app' });
			mgr.completeTask(task.id);
			mgr.archiveCompleted();

			const archived = mgr.getArchivedTasks();
			expect(archived).toHaveLength(1);
			expect(archived[0].workingDirectory).toBe('/projects/my-app');

			mgr.restoreFromArchive(task.id);
			const restored = mgr.getTask(task.id);
			expect(restored?.workingDirectory).toBe('/projects/my-app');
		});

		it('toJSON preserves workingDirectory', () => {
			const task = mgr.addTask('Serialize WD', 10);
			mgr.updateTask(task.id, { workingDirectory: '/some/path' });

			const json = mgr.toJSON();
			expect(json[0].workingDirectory).toBe('/some/path');
		});

		it('undo reverts workingDirectory change', () => {
			const task = mgr.addTask('Undo WD', 10);
			mgr.updateTask(task.id, { workingDirectory: '/changed' });
			expect(mgr.getTask(task.id)?.workingDirectory).toBe('/changed');

			mgr.undo();
			expect(mgr.getTask(task.id)?.workingDirectory).toBeUndefined();
		});
	});

	describe('onChange callback', () => {
		it('fires on mutations', () => {
			let callCount = 0;
			mgr.onChange(() => { callCount++; });

			mgr.addTask('Trigger', 10);
			expect(callCount).toBeGreaterThan(0);
		});
	});

	describe('serialization', () => {
		it('toJSON returns shallow copies', () => {
			const task = mgr.addTask('Serialize', 10);
			const json = mgr.toJSON();

			expect(json).toHaveLength(1);
			expect(json[0].id).toBe(task.id);

			json[0].title = 'Mutated';
			expect(mgr.getTask(task.id)?.title).toBe('Serialize');
		});
	});

	describe('getAverageAccuracy', () => {
		it('returns 100% when no completed tasks', () => {
			const result = mgr.getAverageAccuracy();
			expect(result.accuracyPercent).toBe(100);
		});

		it('computes accuracy from completed tasks', () => {
			const task = mgr.addTask('Work', 30);
			mgr.startTask(task.id, 0);
			mgr.completeTask(task.id);

			const t = mgr.getTask(task.id)!;
			t.actualDurationMinutes = 30;

			const result = mgr.getAverageAccuracy();
			expect(result.avgEstimated).toBe(30);
			expect(result.avgActual).toBe(30);
			expect(result.accuracyPercent).toBe(100);
		});
	});
});
