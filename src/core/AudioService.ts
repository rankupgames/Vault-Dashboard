/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard Welcome
 * Description: Web Audio API tone generator for timer completion and warning sounds
 * Created: 2026-03-08
 * Last Modified: 2026-03-08
 */

import { PluginSettings } from './types';
import { EventBus } from './EventBus';
import { AudioEvents } from './events';

/** Web Audio API tone generator for timer completion and warning sounds. */
export class AudioService {
	private ctx: AudioContext | null = null;
	private settings: PluginSettings;
	private unsubscribers: (() => void)[] = [];

	constructor(settings: PluginSettings, bus?: EventBus) {
		this.settings = settings;
		if (bus) {
			this.unsubscribers.push(
				bus.on(AudioEvents.PlayComplete, () => this.playComplete()),
				bus.on(AudioEvents.PlayWarning, () => this.playWarning()),
			);
		}
	}

	private ensureContext(): AudioContext {
		if (this.ctx === null) {
			this.ctx = new AudioContext();
		}
		return this.ctx;
	}

	/** Plays the completion tone (if enabled in settings). */
	playComplete(): void {
		if (this.settings.audioEnabled === false || this.settings.audioOnComplete === false) return;
		const ctx = this.ensureContext();
		this.playTone(ctx, 523.25, 0.15, 0);
		this.playTone(ctx, 659.25, 0.15, 0.15);
	}

	/** Plays the warning tone when timer goes negative (if enabled). */
	playWarning(): void {
		if (this.settings.audioEnabled === false || this.settings.audioOnNegative === false) return;
		const ctx = this.ensureContext();
		this.playTone(ctx, 220, 0.3, 0);
	}

	private playTone(ctx: AudioContext, frequency: number, duration: number, delay: number): void {
		const osc = ctx.createOscillator();
		const gain = ctx.createGain();
		osc.connect(gain);
		gain.connect(ctx.destination);

		osc.type = 'sine';
		osc.frequency.value = frequency;

		const startTime = ctx.currentTime + delay;
		gain.gain.setValueAtTime(0.3, startTime);
		gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

		osc.start(startTime);
		osc.stop(startTime + duration);
	}

	/** Unsubscribes from events and closes the audio context. */
	destroy(): void {
		for (const unsub of this.unsubscribers) unsub();
		this.unsubscribers = [];
		if (this.ctx) {
			this.ctx.close();
			this.ctx = null;
		}
	}
}
