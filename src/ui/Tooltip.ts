/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard Welcome
 * Description: Custom tooltip system -- fast display, larger than native, positioned via fixed overlay
 * Created: 2026-03-08
 * Last Modified: 2026-03-08
 */

let tooltipEl: HTMLDivElement | null = null;

const ensureTooltip = (ownerDoc: Document): HTMLDivElement => {
	if (tooltipEl && tooltipEl.ownerDocument === ownerDoc) return tooltipEl;

	if (tooltipEl) tooltipEl.remove();
	tooltipEl = ownerDoc.createElement('div');
	tooltipEl.className = 'vw-tooltip';
	ownerDoc.body.appendChild(tooltipEl);
	return tooltipEl;
};

/** Shows a tooltip above the anchor element with the given text. */
export const showTooltip = (anchor: HTMLElement, text: string): void => {
	const ownerDoc = anchor.doc;
	const ownerWin = anchor.win;
	const tip = ensureTooltip(ownerDoc);
	tip.textContent = text;
	tip.classList.add('vw-tooltip-visible');

	const rect = anchor.getBoundingClientRect();
	tip.style.top = `${rect.top - 6}px`;
	tip.style.left = `${rect.left + rect.width / 2}px`;
	tip.style.transform = 'translate(-50%, -100%)';

	requestAnimationFrame(() => {
		const tipRect = tip.getBoundingClientRect();
		if (tipRect.left < 4) {
			tip.style.left = `${4 + tipRect.width / 2}px`;
		} else if (tipRect.right > ownerWin.innerWidth - 4) {
			tip.style.left = `${ownerWin.innerWidth - 4 - tipRect.width / 2}px`;
		}
		if (tipRect.top < 4) {
			tip.style.top = `${rect.bottom + 6}px`;
			tip.style.transform = 'translate(-50%, 0)';
		}
	});
};

/** Hides the currently visible tooltip. */
export const hideTooltip = (): void => {
	if (tooltipEl) {
		tooltipEl.classList.remove('vw-tooltip-visible');
	}
};

/** Attaches a tooltip to an element that shows when its content overflows. */
export const attachOverflowTooltip = (el: HTMLElement, text: string): void => {
	el.addEventListener('mouseenter', () => {
		if (el.scrollWidth > el.clientWidth) {
			showTooltip(el, text);
		}
	});
	el.addEventListener('mouseleave', hideTooltip);
};

/** Removes the tooltip element from the DOM. */
export const destroyTooltip = (): void => {
	if (tooltipEl) {
		tooltipEl.remove();
		tooltipEl = null;
	}
};

/** Renders tag pills into the container, showing up to maxVisible with overflow count. */
export const renderTagPills = (
	container: HTMLElement,
	tags: string[],
	tagColors: Record<string, string>,
	maxVisible = 2,
): void => {
	const area = container.createDiv({ cls: 'vw-tag-pills' });
	const visible = tags.slice(0, maxVisible);
	const overflow = tags.length - maxVisible;

	for (const tag of visible) {
		const pill = area.createSpan({ cls: 'vw-tag-pill', text: tag });
		const color = tagColors[tag];
		if (color) pill.style.backgroundColor = color;
	}

	if (overflow > 0) {
		area.createSpan({ cls: 'vw-tag-pill vw-tag-pill-overflow', text: `+${overflow}` });
	}

	area.addEventListener('mouseenter', () => {
		showTooltip(area, tags.join(', '));
	});
	area.addEventListener('mouseleave', hideTooltip);
};
