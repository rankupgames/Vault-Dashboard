import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../../src/core/EventBus';

describe('EventBus', () => {
	it('delivers payloads to subscribers', () => {
		const bus = new EventBus();
		const spy = vi.fn();

		bus.on<number>('tick', spy);
		bus.emit<number>('tick', 42);

		expect(spy).toHaveBeenCalledOnce();
		expect(spy).toHaveBeenCalledWith(42);
	});

	it('supports multiple listeners on the same event', () => {
		const bus = new EventBus();
		const a = vi.fn();
		const b = vi.fn();

		bus.on('ping', a);
		bus.on('ping', b);
		bus.emit('ping', null);

		expect(a).toHaveBeenCalledOnce();
		expect(b).toHaveBeenCalledOnce();
	});

	it('does not cross-deliver between events', () => {
		const bus = new EventBus();
		const spy = vi.fn();

		bus.on('alpha', spy);
		bus.emit('beta', 'x');

		expect(spy).not.toHaveBeenCalled();
	});

	it('unsubscribes via returned function', () => {
		const bus = new EventBus();
		const spy = vi.fn();

		const unsub = bus.on('evt', spy);
		unsub();
		bus.emit('evt', 1);

		expect(spy).not.toHaveBeenCalled();
	});

	it('unsubscribes via off()', () => {
		const bus = new EventBus();
		const spy = vi.fn();

		bus.on('evt', spy);
		bus.off('evt', spy);
		bus.emit('evt', 1);

		expect(spy).not.toHaveBeenCalled();
	});

	it('off() is safe for unknown events', () => {
		const bus = new EventBus();
		expect(() => bus.off('nope', vi.fn())).not.toThrow();
	});

	it('emit is safe for events with no subscribers', () => {
		const bus = new EventBus();
		expect(() => bus.emit('ghost', {})).not.toThrow();
	});

	it('destroy() removes all listeners', () => {
		const bus = new EventBus();
		const spy = vi.fn();

		bus.on('a', spy);
		bus.on('b', spy);
		bus.destroy();

		bus.emit('a', 1);
		bus.emit('b', 2);

		expect(spy).not.toHaveBeenCalled();
	});
});
