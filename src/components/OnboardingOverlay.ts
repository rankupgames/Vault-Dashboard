/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard Welcome
 * Description: Inline 4-step onboarding walkthrough for first-run users
 * Created: 2026-03-08
 * Last Modified: 2026-03-08
 */

import { PluginSettings } from '../types';

interface OnboardingStep {
	title: string;
	description: string;
	icon: string;
}

const STEPS: OnboardingStep[] = [
	{
		title: 'Add your first task',
		description: 'Click the "+ Add Task" button in the task timeline to create a timed task with a title, duration, and optional subtasks.',
		icon: 'plus-circle',
	},
	{
		title: 'Start the timer',
		description: 'Press the play button on a task to start a clock-aligned timer. It snaps to the next clean time boundary so your sessions end on the hour or half-hour.',
		icon: 'play-circle',
	},
	{
		title: 'Explore modules',
		description: 'The right panel has collapsible widgets: daily reports, quick access docs, and a heatmap tracker. Toggle and reorder them to fit your workflow.',
		icon: 'layout-grid',
	},
	{
		title: "You're ready!",
		description: 'Use keyboard shortcuts, tags, templates, and the pomodoro mode toggle to customize your productivity flow. Have a great session!',
		icon: 'rocket',
	},
];

export interface OnboardingOverlayDeps {
	settings: PluginSettings;
	onDismiss: () => void;
}

export class OnboardingOverlay {
	private deps: OnboardingOverlayDeps;
	private currentStep = 0;
	private container: HTMLElement | null = null;

	constructor(deps: OnboardingOverlayDeps) {
		this.deps = deps;
	}

	shouldShow(): boolean {
		return this.deps.settings.hasSeenOnboarding === false;
	}

	render(parent: HTMLElement): void {
		if (this.shouldShow() === false) return;

		this.container = parent.createDiv({ cls: 'vw-onboarding-overlay' });
		this.renderStep();
	}

	private renderStep(): void {
		if (this.container === null) return;
		this.container.empty();

		const step = STEPS[this.currentStep];
		const card = this.container.createDiv({ cls: 'vw-onboarding-card' });

		const progress = card.createDiv({ cls: 'vw-onboarding-progress' });
		for (let i = 0; i < STEPS.length; i++) {
			const dot = progress.createSpan({ cls: 'vw-onboarding-dot' });
			if (i === this.currentStep) dot.addClass('vw-onboarding-dot-active');
			if (i < this.currentStep) dot.addClass('vw-onboarding-dot-done');
		}

		card.createDiv({ cls: 'vw-onboarding-step-count', text: `Step ${this.currentStep + 1} of ${STEPS.length}` });
		card.createDiv({ cls: 'vw-onboarding-title', text: step.title });
		card.createDiv({ cls: 'vw-onboarding-desc', text: step.description });

		const actions = card.createDiv({ cls: 'vw-onboarding-actions' });

		const skipBtn = actions.createEl('button', { cls: 'vw-onboarding-btn-skip', text: 'Skip' });
		skipBtn.addEventListener('click', () => this.dismiss());

		if (this.currentStep < STEPS.length - 1) {
			const nextBtn = actions.createEl('button', { cls: 'vw-onboarding-btn-next', text: 'Next' });
			nextBtn.addEventListener('click', () => {
				this.currentStep++;
				this.renderStep();
			});
		} else {
			const doneBtn = actions.createEl('button', { cls: 'vw-onboarding-btn-next', text: 'Get Started' });
			doneBtn.addEventListener('click', () => this.dismiss());
		}
	}

	private dismiss(): void {
		this.deps.settings.hasSeenOnboarding = true;
		this.deps.onDismiss();
		if (this.container) {
			this.container.remove();
			this.container = null;
		}
	}
}
