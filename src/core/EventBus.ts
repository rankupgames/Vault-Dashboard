/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard Welcome
 * Description: Lightweight typed pub/sub for decoupled cross-system communication
 * Created: 2026-03-09
 * Last Modified: 2026-03-09
 */

type Listener<T = unknown> = (payload: T) => void;

/** Lightweight typed pub/sub for decoupled cross-system communication. */
export class EventBus {
	private listeners = new Map<string, Set<Listener>>();

	/**
	 * Subscribe to an event.
	 * @param event - Event name
	 * @param fn - Callback receiving the payload
	 * @returns Unsubscribe function
	 */
	on<T>(event: string, fn: Listener<T>): () => void {
		if (this.listeners.has(event) === false) {
			this.listeners.set(event, new Set());
		}
		const set = this.listeners.get(event)!;
		set.add(fn as Listener);
		return () => set.delete(fn as Listener);
	}

	/**
	 * Emit an event to all subscribers.
	 * @param event - Event name
	 * @param payload - Payload to pass to listeners
	 */
	emit<T>(event: string, payload: T): void {
		const set = this.listeners.get(event);
		if (set === undefined) return;
		for (const fn of set) {
			fn(payload);
		}
	}

	/**
	 * Remove a specific listener from an event.
	 * @param event - Event name
	 * @param fn - Callback to remove
	 */
	off<T>(event: string, fn: Listener<T>): void {
		const set = this.listeners.get(event);
		if (set === undefined) return;
		set.delete(fn as Listener);
	}

	/** Clear all listeners and release resources. */
	destroy(): void {
		this.listeners.clear();
	}
}
