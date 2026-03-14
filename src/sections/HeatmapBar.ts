/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard Welcome
 * Description: Heatmap contribution grid displayed in the top bar alongside the timer
 * Created: 2026-03-07
 * Last Modified: 2026-03-07
 */

import { App, TFile, TFolder, CachedMetadata, setIcon } from 'obsidian';
import { Task } from '../core/types';
import type { SectionRenderer, SectionZone } from '../interfaces/SectionRenderer';

/** Dependencies for the heatmap bar. */
export interface HeatmapBarDeps {
	app: App;
	tasks: Task[];
	colorScheme?: string;
	tagFilter?: string;
	dailyNotesFolder?: string;
	skipAutoScroll?: boolean;
}

/** Heatmap contribution grid displayed in the top bar alongside the timer. */
export class HeatmapBar implements SectionRenderer {
	readonly id = 'heatmap';
	readonly zone: SectionZone = 'top-bar';
	readonly order = 1;
	private deps: HeatmapBarDeps;
	private container: HTMLElement | null = null;
	private tooltipEl: HTMLElement | null = null;

	/** Creates the heatmap bar with the given dependencies. */
	constructor(deps: HeatmapBarDeps) {
		this.deps = deps;
	}

	/**
	 * Updates the task list used for contribution counts.
	 * @param tasks - Tasks to use for heatmap data
	 */
	updateTasks(tasks: Task[]): void {
		this.deps.tasks = tasks;
	}

	/**
	 * Renders the heatmap grid into the given parent.
	 * @param parent - Container element
	 */
	render(parent: HTMLElement): void {
		this.container = parent.createDiv({ cls: 'vw-heatmap-bar' });
		this.renderGrid(this.container);
	}

	/** Removes the tooltip and container element. */
	destroy(): void {
		this.removeTooltip();
		if (this.container) {
			this.container.remove();
			this.container = null;
		}
	}

	/** Positions and displays a floating tooltip above or below a heatmap cell. */
	private showTooltip(cell: HTMLElement, text: string): void {
		this.removeTooltip();
		const ownerDoc = cell.doc;
		const ownerWin = cell.win;
		const tip = ownerDoc.createElement('div');
		tip.className = 'vw-heatmap-tooltip';
		tip.textContent = text;
		ownerDoc.body.appendChild(tip);
		this.tooltipEl = tip;

		const rect = cell.getBoundingClientRect();
		const tipRect = tip.getBoundingClientRect();

		let top = rect.top - tipRect.height - 6;
		let left = rect.left + rect.width / 2 - tipRect.width / 2;

		if (top < 4) {
			top = rect.bottom + 6;
		}
		if (left < 4) {
			left = 4;
		} else if (left + tipRect.width > ownerWin.innerWidth - 4) {
			left = ownerWin.innerWidth - tipRect.width - 4;
		}

		tip.style.top = `${top}px`;
		tip.style.left = `${left}px`;
	}

	/** Removes the active heatmap tooltip from the DOM. */
	private removeTooltip(): void {
		if (this.tooltipEl) {
			this.tooltipEl.remove();
			this.tooltipEl = null;
		}
	}

	/** Builds the full heatmap grid with month columns, day cells, header, stats, and legend. */
	private renderGrid(el: HTMLElement): void {
		const tagFilter = this.deps.tagFilter ?? 'Task';

		const dailyNoteCounts = this.collectDailyNoteTags(tagFilter);
		const taskCounts = this.collectCompletedTaskCounts();
		const merged = this.mergeCounts(dailyNoteCounts, taskCounts);

		const wrapper = el.createDiv({ cls: 'vw-heatmap-wrapper' });
		const today = new Date();
		const year = today.getFullYear();

		const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
		const dayLabels = ['', 'Mon', '', 'Wed', '', 'Fri', ''];

		const janFirst = new Date(year, 0, 1);
		const decThirtyFirst = new Date(year, 11, 31);

		const startDate = new Date(janFirst);
		startDate.setDate(startDate.getDate() - startDate.getDay());

		const endDate = new Date(decThirtyFirst);
		endDate.setDate(endDate.getDate() + (6 - endDate.getDay()));

		const weeks: Date[][] = [];
		const cursor = new Date(startDate);
		while (cursor <= endDate) {
			const week: Date[] = [];
			for (let d = 0; d < 7; d++) {
				week.push(new Date(cursor));
				cursor.setDate(cursor.getDate() + 1);
			}
			weeks.push(week);
		}

		const monthGroups: { month: number; weeks: Date[][] }[] = [];
		for (const week of weeks) {
			const hasThisYear = week.some((d) => d.getFullYear() === year);
			if (hasThisYear === false) continue;

			let m = -1;
			for (const d of week) {
				if (d.getFullYear() === year) { m = d.getMonth(); break; }
			}

			const last = monthGroups.length > 0 ? monthGroups[monthGroups.length - 1] : null;
			if (last && last.month === m) {
				last.weeks.push(week);
			} else {
				monthGroups.push({ month: m, weeks: [week] });
			}
		}

		const totalTasks = Array.from(merged.entries())
			.filter(([k]) => k.startsWith(String(year)))
			.reduce((s, [, v]) => s + v, 0);
		const streaks = this.computeStreaks(merged);

		const hdr = wrapper.createDiv({ cls: 'vw-heatmap-header' });
		hdr.createSpan({ cls: 'vw-heatmap-total', text: `${totalTasks} tasks completed in ${year}` });

		const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
		const todayLabel = `${dayNames[today.getDay()]}, ${monthNames[today.getMonth()]} ${today.getDate()}`;
		hdr.createSpan({ cls: 'vw-heatmap-today-label', text: todayLabel });

		const maxCount = Math.max(1, ...Array.from(merged.values()));
		const todayStr = this.formatDate(today);

		const grid = wrapper.createDiv({ cls: 'vw-heatmap-grid' });

		const labelCol = grid.createDiv({ cls: 'vw-heatmap-labels' });
		for (const label of dayLabels) {
			labelCol.createDiv({ cls: 'vw-heatmap-day-label', text: label });
		}

		for (const group of monthGroups) {
			const monthCol = grid.createDiv({ cls: 'vw-heatmap-month-col' });
			monthCol.createDiv({ cls: 'vw-heatmap-month-label', text: monthNames[group.month] });

			const weeksContainer = monthCol.createDiv({ cls: 'vw-heatmap-weeks' });

			for (const week of group.weeks) {
				const weekCol = weeksContainer.createDiv({ cls: 'vw-heatmap-week' });
				for (const day of week) {
					const isThisYear = day.getFullYear() === year;
					const isFuture = day > today;
					const dateStr = this.formatDate(day);
					const count = merged.get(dateStr) ?? 0;
					const intensity = (isThisYear === false || isFuture) ? 0 : (count === 0 ? 0 : Math.ceil((count / maxCount) * 4));

					const cls = isThisYear === false
						? 'vw-heatmap-cell vw-heatmap-outside'
						: `vw-heatmap-cell${intensity > 0 ? ` vw-heatmap-${intensity}` : ''}`;

				const cell = weekCol.createDiv({ cls });

				const isToday = dateStr === todayStr;
				if (isToday) {
					cell.addClass('vw-heatmap-today');
				}

				if (isThisYear && isFuture === false) {
					const dayName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day.getDay()];
					const tooltip = count > 0
						? `${count} task${count !== 1 ? 's' : ''} on ${dayName}, ${monthNames[day.getMonth()]} ${day.getDate()}`
						: `No tasks on ${dayName}, ${monthNames[day.getMonth()]} ${day.getDate()}`;
					cell.addClass('vw-heatmap-hoverable');
					cell.addEventListener('mouseenter', () => this.showTooltip(cell, tooltip));
					cell.addEventListener('mouseleave', () => this.removeTooltip());
				}
				}
			}
		}

		if (this.deps.skipAutoScroll === false || this.deps.skipAutoScroll === undefined) {
			requestAnimationFrame(() => {
				const todayCell = grid.querySelector('.vw-heatmap-today');
				if (todayCell) {
					todayCell.scrollIntoView({ inline: 'center', block: 'nearest' });
				}
			});
		}

		const footer = wrapper.createDiv({ cls: 'vw-heatmap-footer' });

		const statsRow = footer.createDiv({ cls: 'vw-heatmap-stats-row' });
		const weeklyCompleted = this.countWeeklyCompleted();

		this.renderStatChip(statsRow, 'check-circle', String(weeklyCompleted), 'Completed this week');

		const isNewRecord = streaks.current > 0 && streaks.current >= streaks.longest;
		this.renderStatChip(statsRow, 'flame', `${streaks.current}d`, 'Current streak', isNewRecord ? 'vw-heatmap-stat-highlight' : undefined);
		if (streaks.longest > 0) {
			this.renderStatChip(statsRow, 'trophy', `${streaks.longest}d`, 'Longest streak');
		}

		const legend = footer.createDiv({ cls: 'vw-heatmap-legend' });
		legend.createSpan({ text: 'Less' });
		for (let i = 0; i <= 4; i++) {
			const cls = i === 0 ? 'vw-heatmap-cell' : `vw-heatmap-cell vw-heatmap-${i}`;
			legend.createDiv({ cls });
		}
		legend.createSpan({ text: 'More' });
	}

	/** Creates a small icon + value chip in the stats row. */
	private renderStatChip(parent: HTMLElement, icon: string, value: string, tooltip: string, extraCls?: string): void {
		const chip = parent.createDiv({ cls: 'vw-heatmap-stat-chip' });
		if (extraCls) chip.addClass(extraCls);
		chip.setAttribute('aria-label', tooltip);
		chip.setAttribute('tabindex', '0');

		const iconEl = chip.createSpan({ cls: 'vw-heatmap-stat-icon' });
		setIcon(iconEl, icon);
		chip.createSpan({ cls: 'vw-heatmap-stat-val', text: value });
	}

	/** Counts tasks completed since the start of the current ISO week (Monday). */
	private countWeeklyCompleted(): number {
		const now = new Date();
		const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
		const dayOfWeek = startOfDay.getDay();
		const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
		const cutoff = startOfDay.getTime() - mondayOffset * 86400000;

		return this.deps.tasks.filter((t) =>
			t.status === 'completed' && t.completedAt !== undefined && t.completedAt >= cutoff,
		).length;
	}

	/** Computes the current and longest consecutive-day streaks from merged counts. */
	private computeStreaks(merged: Map<string, number>): { current: number; longest: number } {
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		let streak = 0;

		const cursor = new Date(today);
		const dateStr = this.formatDate(cursor);
		const todayCount = merged.get(dateStr) ?? 0;
		if (todayCount > 0) {
			streak = 1;
		}

		cursor.setDate(cursor.getDate() - 1);
		while (true) {
			const ds = this.formatDate(cursor);
			const count = merged.get(ds) ?? 0;
			if (count === 0) break;
			streak++;
			cursor.setDate(cursor.getDate() - 1);
		}
		const current = streak;
		let longest = streak;

		const entries = Array.from(merged.entries())
			.filter(([, v]) => v > 0)
			.map(([k]) => k)
			.sort();
		let run = 0;
		for (let i = 0; i < entries.length; i++) {
			if (i === 0) { run = 1; continue; }
			const prev = new Date(entries[i - 1] + 'T00:00:00');
			const curr = new Date(entries[i] + 'T00:00:00');
			const diffDays = (curr.getTime() - prev.getTime()) / 86400000;
			if (diffDays === 1) {
				run++;
			} else {
				run = 1;
			}
			if (run > longest) longest = run;
		}

		return { current, longest };
	}

	/** Scans daily notes for tag occurrences matching the given prefix. */
	private collectDailyNoteTags(tagPrefix: string): Map<string, number> {
		const folderPath = this.deps.dailyNotesFolder ?? '_DailyNotes';
		const folder = this.deps.app.vault.getAbstractFileByPath(folderPath);
		if (folder === null || !(folder instanceof TFolder)) return new Map();

		const counts = new Map<string, number>();
		const hashTag = `#${tagPrefix}`;

		for (const child of folder.children) {
			if (child instanceof TFile === false) continue;
			const file = child as TFile;
			if (file.extension !== 'md') continue;

			const dateMatch = file.basename.match(/^(\d{4}-\d{2}-\d{2})$/);
			if (dateMatch === null) continue;

			const dateStr = dateMatch[1];
			const cache: CachedMetadata | null = this.deps.app.metadataCache.getFileCache(file);
			if (cache === null) {
				counts.set(dateStr, 0);
				continue;
			}

			let tagCount = 0;
			if (cache.tags) {
				tagCount = cache.tags.filter((t) => t.tag.startsWith(hashTag)).length;
			}
			counts.set(dateStr, tagCount);
		}

		return counts;
	}

	/** Groups completed tasks by date string for heatmap contribution counts. */
	private collectCompletedTaskCounts(): Map<string, number> {
		const counts = new Map<string, number>();

		for (const task of this.deps.tasks) {
			if (task.status !== 'completed' || task.completedAt === undefined) continue;

			const dateStr = this.formatDate(new Date(task.completedAt));
			counts.set(dateStr, (counts.get(dateStr) ?? 0) + 1);
		}

		return counts;
	}

	/** Merges two date-keyed count maps by summing overlapping entries. */
	private mergeCounts(a: Map<string, number>, b: Map<string, number>): Map<string, number> {
		const merged = new Map(a);
		for (const [date, count] of b) {
			merged.set(date, (merged.get(date) ?? 0) + count);
		}
		return merged;
	}

	/** Formats a Date to YYYY-MM-DD string. */
	private formatDate(d: Date): string {
		const y = d.getFullYear();
		const m = String(d.getMonth() + 1).padStart(2, '0');
		const day = String(d.getDate()).padStart(2, '0');
		return `${y}-${m}-${day}`;
	}
}
