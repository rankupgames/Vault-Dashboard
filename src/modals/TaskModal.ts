/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard Welcome
 * Description: Unified add/edit task modal with subtask bulk entry
 * Created: 2026-03-07
 * Last Modified: 2026-03-07
 */

import { App, Modal, setIcon, TFile, normalizePath } from 'obsidian';
import { Task, SubTask, PluginSettings } from '../types';
import { attachOverflowTooltip } from '../Tooltip';
import { FileSuggestModal } from './FileSuggestModal';

const MAX_SUBTASK_DEPTH = 4;

const cloneSubtasks = (subs: SubTask[]): SubTask[] =>
	subs.map((s) => ({
		...s,
		subtasks: s.subtasks ? cloneSubtasks(s.subtasks) : undefined,
	}));

export interface TaskModalResult {
	title: string;
	durationMinutes: number;
	subtasks?: SubTask[];
	tags?: string[];
	linkedDocs?: string[];
}

export class TaskModal extends Modal {
	private task: Task | null;
	private settings: PluginSettings;
	private knownTags: string[];
	private onSave: (result: TaskModalResult) => void;
	private pendingSubtasks: SubTask[] = [];
	private pendingTags: string[] = [];
	private pendingLinkedDocs: string[] = [];
	private subtaskListEl: HTMLElement | null = null;
	private tagListEl: HTMLElement | null = null;
	private tagSuggestEl: HTMLElement | null = null;
	private linkedDocsListEl: HTMLElement | null = null;
	private dragSub: { arr: SubTask[]; idx: number } | null = null;

	constructor(app: App, task: Task | null, settings: PluginSettings, onSave: (result: TaskModalResult) => void, knownTags: string[] = []) {
		super(app);
		this.task = task;
		this.settings = settings;
		this.knownTags = knownTags;
		this.onSave = onSave;

		if (task?.subtasks) {
			this.pendingSubtasks = cloneSubtasks(task.subtasks);
		}
		if (task?.tags) {
			this.pendingTags = [...task.tags];
		}
		if (task?.linkedDocs) {
			this.pendingLinkedDocs = [...task.linkedDocs];
		}
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass('vw-task-edit-modal');

		const isEdit = this.task !== null;
		contentEl.createEl('h3', { text: isEdit ? 'Edit Task' : 'Add Task' });

		const form = contentEl.createDiv({ cls: 'vw-edit-form' });

		let titleInput: HTMLInputElement;
		let durHours: number;
		let durMins: number;
		const updateDurDisplayRef = { fn: (): void => {} };

		if (isEdit === false) {
			form.createDiv({ cls: 'vw-edit-label', text: 'From Template' });
			if (this.settings.templates.length > 0) {
				const tmplSelect = form.createEl('select', { cls: 'vw-edit-input' });
				tmplSelect.createEl('option', { text: '-- None --', attr: { value: '' } });
				for (const tmpl of this.settings.templates) {
					tmplSelect.createEl('option', { text: `${tmpl.name} (${tmpl.durationMinutes}m)`, attr: { value: tmpl.id } });
				}
				tmplSelect.addEventListener('change', () => {
					const tmpl = this.settings.templates.find((t) => t.id === tmplSelect.value);
					if (tmpl === undefined) return;
					titleInput.value = tmpl.name;
					durHours = Math.floor(tmpl.durationMinutes / 60);
					durMins = tmpl.durationMinutes % 60;
					updateDurDisplayRef.fn();
					if (tmpl.tags) { this.pendingTags = [...tmpl.tags]; this.refreshTagList(); }
					if (tmpl.subtasks) { this.pendingSubtasks = cloneSubtasks(tmpl.subtasks); this.refreshSubtaskList(); }
				});
			} else {
				form.createDiv({ cls: 'vw-edit-hint', text: 'No templates yet -- edit a task and use "Save as Template"' });
			}
		}

		form.createDiv({ cls: 'vw-edit-label', text: 'Title' });
		titleInput = form.createEl('input', {
			cls: 'vw-edit-input',
			attr: { type: 'text', value: this.task?.title ?? '', placeholder: 'Task title' },
		});

		form.createDiv({ cls: 'vw-edit-label', text: 'Duration' });
		const durRow = form.createDiv({ cls: 'vw-duration-stepper' });
		durHours = this.task ? Math.floor(this.task.durationMinutes / 60) : 0;
		durMins = this.task ? this.task.durationMinutes % 60 : 30;

		const hoursDisplay = durRow.createDiv({ cls: 'vw-dur-display' });
		const minsDisplay = durRow.createDiv({ cls: 'vw-dur-display' });

		const updateDurDisplay = (): void => {
			hoursDisplay.setText(`${durHours}h`);
			minsDisplay.setText(`${durMins}m`);
		};
		updateDurDisplay();
		updateDurDisplayRef.fn = updateDurDisplay;

		const stepHours = (delta: number): void => {
			durHours = Math.max(0, Math.min(12, durHours + delta));
			updateDurDisplay();
		};
		const stepMins = (delta: number): void => {
			durMins += delta;
			if (durMins > 55) { durMins = 0; stepHours(1); return; }
			if (durMins < 0) { durMins = 55; stepHours(-1); return; }
			updateDurDisplay();
		};

		const buildStepper = (display: HTMLElement, label: string, onStep: (d: number) => void): void => {
			const group = durRow.createDiv({ cls: 'vw-dur-group' });
			const minus = group.createEl('button', { cls: 'vw-dur-btn' });
			setIcon(minus, 'minus');
			group.appendChild(display);
			const plus = group.createEl('button', { cls: 'vw-dur-btn' });
			setIcon(plus, 'plus');
			minus.addEventListener('click', (e) => { e.preventDefault(); onStep(-1); });
			plus.addEventListener('click', (e) => { e.preventDefault(); onStep(1); });
		};

		durRow.empty();
		buildStepper(hoursDisplay, 'h', (d) => stepHours(d));
		buildStepper(minsDisplay, 'm', (d) => stepMins(d * 5));

		form.createDiv({ cls: 'vw-edit-label', text: 'Tags' });
		this.tagListEl = form.createDiv({ cls: 'vw-tag-pills' });
		this.refreshTagList();

		const tagInputWrap = form.createDiv({ cls: 'vw-tag-input-wrap' });
		const tagInput = tagInputWrap.createEl('input', {
			cls: 'vw-modal-subtask-input',
			attr: { type: 'text', placeholder: 'Add tag (Enter to add)' },
		});
		this.tagSuggestEl = tagInputWrap.createDiv({ cls: 'vw-tag-suggest' });

		const addTag = (tag: string): void => {
			if (tag === '' || this.pendingTags.includes(tag)) return;
			this.pendingTags.push(tag);
			tagInput.value = '';
			this.refreshTagList();
			this.refreshTagSuggestions('');
		};

		tagInput.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				addTag(tagInput.value.trim().toLowerCase());
			}
		});
		tagInput.addEventListener('input', () => {
			this.refreshTagSuggestions(tagInput.value.trim().toLowerCase());
		});
		tagInput.addEventListener('focus', () => {
			this.refreshTagSuggestions(tagInput.value.trim().toLowerCase());
		});

		this.refreshTagSuggestions('');

		const docsSection = form.createDiv({ cls: 'vw-modal-docs-section' });
		docsSection.createDiv({ cls: 'vw-edit-label', text: 'Linked Documents' });
		this.linkedDocsListEl = docsSection.createDiv({ cls: 'vw-modal-docs-list' });
		this.refreshLinkedDocsList();

		const docsActions = docsSection.createDiv({ cls: 'vw-modal-docs-actions' });

		const linkExistingBtn = docsActions.createEl('button', { cls: 'vw-timer-btn vw-timer-btn-sm' });
		const linkIcon = linkExistingBtn.createSpan({ cls: 'vw-btn-icon' });
		setIcon(linkIcon, 'link');
		linkExistingBtn.createSpan({ text: ' Link Existing' });
		linkExistingBtn.addEventListener('click', (e) => {
			e.preventDefault();
			new FileSuggestModal(this.app, (file: TFile) => {
				if (this.pendingLinkedDocs.includes(file.path) === false) {
					this.pendingLinkedDocs.push(file.path);
					this.refreshLinkedDocsList();
				}
			}).open();
		});

		const createNewBtn = docsActions.createEl('button', { cls: 'vw-timer-btn vw-timer-btn-sm' });
		const createIcon = createNewBtn.createSpan({ cls: 'vw-btn-icon' });
		setIcon(createIcon, 'file-plus');
		createNewBtn.createSpan({ text: ' Create New' });
		createNewBtn.addEventListener('click', (e) => {
			e.preventDefault();
			this.showCreateDocInput(docsSection);
		});

		const subtaskSection = form.createDiv({ cls: 'vw-modal-subtask-section' });
		subtaskSection.createDiv({ cls: 'vw-modal-subtask-header', text: 'Subtasks' });
		this.subtaskListEl = subtaskSection.createDiv({ cls: 'vw-modal-subtask-list' });
		this.renderSubtaskTree(this.subtaskListEl, this.pendingSubtasks, 0);

		const inputRow = subtaskSection.createDiv({ cls: 'vw-modal-subtask-input-row' });
		const subtaskInput = inputRow.createEl('input', {
			cls: 'vw-modal-subtask-input',
			attr: { type: 'text', placeholder: 'Add subtask (Enter to add)' },
		});

		subtaskInput.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				const title = subtaskInput.value.trim();
				if (title === '') return;
				this.pendingSubtasks.push({
					id: `_new_${Date.now().toString(36)}${Math.random().toString(36).substring(2, 6)}`,
					title,
					status: 'pending',
				});
				subtaskInput.value = '';
				this.refreshSubtaskList();
			}
		});

		const actions = form.createDiv({ cls: 'vw-edit-actions' });

		if (isEdit) {
			const tmplBtn = actions.createEl('button', { cls: 'vw-timer-btn', text: 'Save as Template' });
			tmplBtn.addEventListener('click', (e) => {
				e.preventDefault();
				const name = titleInput.value.trim();
				if (name === '') return;
				this.settings.templates.push({
					id: Date.now().toString(36) + Math.random().toString(36).substring(2, 6),
					name,
					durationMinutes: Math.max(durHours * 60 + durMins, 5),
					subtasks: this.pendingSubtasks.length > 0 ? cloneSubtasks(this.pendingSubtasks) : undefined,
					tags: this.pendingTags.length > 0 ? [...this.pendingTags] : undefined,
				});
				tmplBtn.setText('Saved!');
				setTimeout(() => tmplBtn.setText('Save as Template'), 1500);
			});
		}

		const saveBtn = actions.createEl('button', { cls: 'vw-timer-btn vw-timer-btn-primary', text: 'Save' });
		const cancelBtn = actions.createEl('button', { cls: 'vw-timer-btn', text: 'Cancel' });

		const doSave = (): void => {
			const title = titleInput.value.trim();
			if (title === '') return;
			this.onSave({
				title,
				durationMinutes: Math.max(durHours * 60 + durMins, 5),
				subtasks: this.pendingSubtasks.length > 0 ? this.pendingSubtasks : undefined,
				tags: this.pendingTags.length > 0 ? [...this.pendingTags] : undefined,
				linkedDocs: this.pendingLinkedDocs.length > 0 ? [...this.pendingLinkedDocs] : undefined,
			});
			this.close();
		};

		saveBtn.addEventListener('click', doSave);
		cancelBtn.addEventListener('click', () => this.close());

		titleInput.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter') { e.preventDefault(); doSave(); }
		});

		requestAnimationFrame(() => {
			titleInput.focus();
			if (isEdit) titleInput.select();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private refreshTagList(): void {
		if (this.tagListEl === null) return;
		this.tagListEl.empty();
		for (const tag of this.pendingTags) {
			const pill = this.tagListEl.createSpan({ cls: 'vw-tag-pill vw-tag-pill-removable', text: tag });
			const color = this.settings.tagColors[tag];
			if (color) pill.style.backgroundColor = color;
			pill.addEventListener('click', () => {
				this.pendingTags = this.pendingTags.filter((t) => t !== tag);
				this.refreshTagList();
				this.refreshTagSuggestions('');
			});
		}
	}

	private refreshTagSuggestions(filter: string): void {
		if (this.tagSuggestEl === null) return;
		this.tagSuggestEl.empty();

		const available = this.knownTags.filter(
			(t) => this.pendingTags.includes(t) === false && (filter === '' || t.includes(filter)),
		);

		if (available.length === 0) {
			this.tagSuggestEl.style.display = 'none';
			return;
		}

		this.tagSuggestEl.style.display = 'flex';
		for (const tag of available) {
			const chip = this.tagSuggestEl.createSpan({ cls: 'vw-tag-suggest-chip', text: tag });
			const color = this.settings.tagColors[tag];
			if (color) chip.style.borderColor = color;
			chip.addEventListener('click', () => {
				this.pendingTags.push(tag);
				this.refreshTagList();
				this.refreshTagSuggestions(filter);
			});
		}
	}

	private refreshSubtaskList(): void {
		if (this.subtaskListEl === null) return;
		this.subtaskListEl.empty();
		this.renderSubtaskTree(this.subtaskListEl, this.pendingSubtasks, 0);
	}

	private renderSubtaskTree(container: HTMLElement, subtasks: SubTask[], depth: number): void {
		const depthIdx = Math.min(depth, 3);

		const branch = depth === 0
			? container.createDiv({ cls: 'vw-git-branch' })
			: container;

		for (let i = 0; i < subtasks.length; i++) {
			const sub = subtasks[i];
			const wrapper = branch.createDiv({ cls: `vw-git-branch-wrap vw-git-depth-${depthIdx}` });

			const row = wrapper.createDiv({ cls: 'vw-git-branch-row' });

			this.setupSubtaskDrag(wrapper, row, branch, subtasks, i);

			const subDotCls = sub.status === 'completed'
				? 'vw-git-sub-dot vw-git-sub-dot-completed'
				: 'vw-git-sub-dot';
			const dot = row.createDiv({ cls: subDotCls });
			dot.style.cursor = 'pointer';
			dot.addEventListener('click', () => {
				sub.status = sub.status === 'completed' ? 'pending' : 'completed';
				this.refreshSubtaskList();
			});

			const titleCls = sub.status === 'completed'
				? 'vw-subtask-row vw-subtask-completed'
				: 'vw-subtask-row';
			const titleWrap = row.createDiv({ cls: titleCls });
			const titleEl = titleWrap.createSpan({ cls: 'vw-subtask-text vw-subtask-text-editable', text: sub.title });
			attachOverflowTooltip(titleEl, sub.title);

			titleEl.addEventListener('click', (e) => {
				e.stopPropagation();
				const input = createEl('input', {
					cls: 'vw-modal-subtask-input',
					attr: { type: 'text', value: sub.title },
				});
				titleEl.replaceWith(input);
				input.focus();
				input.select();

				const save = (): void => {
					const val = input.value.trim();
					if (val !== '') sub.title = val;
					this.refreshSubtaskList();
				};

				input.addEventListener('keydown', (ke: KeyboardEvent) => {
					if (ke.key === 'Enter') { ke.preventDefault(); save(); }
					else if (ke.key === 'Escape') { ke.preventDefault(); this.refreshSubtaskList(); }
				});
				input.addEventListener('blur', save);
			});

			const actions = row.createDiv({ cls: 'vw-modal-subtask-actions' });

			if (depth < MAX_SUBTASK_DEPTH - 1) {
				const addChildBtn = actions.createDiv({ cls: 'vw-modal-subtask-add' });
				setIcon(addChildBtn, 'plus');
				addChildBtn.setAttribute('aria-label', 'Add child subtask');
				addChildBtn.addEventListener('click', (e) => {
					e.stopPropagation();
					this.showChildInput(wrapper, sub, depth + 1);
				});
			}

			const removeBtn = actions.createDiv({ cls: 'vw-modal-subtask-remove' });
			setIcon(removeBtn, 'x');
			removeBtn.setAttribute('aria-label', 'Remove subtask');
			removeBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				subtasks.splice(i, 1);
				this.refreshSubtaskList();
			});

			const hasChildren = sub.subtasks && sub.subtasks.length > 0;
			if (hasChildren) {
				const children = wrapper.createDiv({ cls: 'vw-git-branch-children' });
				this.renderSubtaskTree(children, sub.subtasks!, depth + 1);
			}
		}
	}

	private setupSubtaskDrag(
		wrapper: HTMLElement,
		row: HTMLElement,
		container: HTMLElement,
		subtasks: SubTask[],
		idx: number,
	): void {
		let pressTime = 0;
		const HOLD_MS = 200;

		row.addEventListener('mousedown', () => {
			pressTime = Date.now();
			wrapper.setAttribute('draggable', 'true');
		});

		row.addEventListener('mouseup', () => {
			wrapper.removeAttribute('draggable');
		});

		wrapper.addEventListener('dragstart', (e: DragEvent) => {
			if (Date.now() - pressTime < HOLD_MS) {
				e.preventDefault();
				wrapper.removeAttribute('draggable');
				return;
			}
			this.dragSub = { arr: subtasks, idx };
			wrapper.addClass('vw-dragging');
			e.dataTransfer?.setData('text/plain', String(idx));
			if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
		});

		wrapper.addEventListener('dragend', () => {
			this.dragSub = null;
			wrapper.removeClass('vw-dragging');
			wrapper.removeAttribute('draggable');
			container.querySelectorAll('.vw-drag-above, .vw-drag-below').forEach((el) => {
				el.classList.remove('vw-drag-above', 'vw-drag-below');
			});
		});

		wrapper.addEventListener('dragover', (e: DragEvent) => {
			if (this.dragSub === null || this.dragSub.arr !== subtasks || this.dragSub.idx === idx) return;
			e.preventDefault();
			e.stopPropagation();
			if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
			const rect = wrapper.getBoundingClientRect();
			const above = e.clientY < rect.top + rect.height / 2;
			wrapper.toggleClass('vw-drag-above', above);
			wrapper.toggleClass('vw-drag-below', above === false);
		});

		wrapper.addEventListener('dragleave', () => {
			wrapper.removeClass('vw-drag-above');
			wrapper.removeClass('vw-drag-below');
		});

		wrapper.addEventListener('drop', (e: DragEvent) => {
			e.preventDefault();
			e.stopPropagation();
			wrapper.removeClass('vw-drag-above');
			wrapper.removeClass('vw-drag-below');
			if (this.dragSub === null || this.dragSub.arr !== subtasks || this.dragSub.idx === idx) return;

			const fromIdx = this.dragSub.idx;
			const rect = wrapper.getBoundingClientRect();
			const above = e.clientY < rect.top + rect.height / 2;

			const [moved] = subtasks.splice(fromIdx, 1);
			const adjustedTarget = fromIdx < idx ? idx - 1 : idx;
			const insertAt = above ? adjustedTarget : adjustedTarget + 1;
			subtasks.splice(insertAt, 0, moved);

			this.dragSub = null;
			this.refreshSubtaskList();
		});
	}

	private refreshLinkedDocsList(): void {
		if (this.linkedDocsListEl === null) return;
		this.linkedDocsListEl.empty();

		if (this.pendingLinkedDocs.length === 0) {
			this.linkedDocsListEl.createDiv({ cls: 'vw-modal-docs-empty', text: 'No documents linked' });
			return;
		}

		for (const docPath of this.pendingLinkedDocs) {
			const row = this.linkedDocsListEl.createDiv({ cls: 'vw-modal-doc-row' });

			const iconEl = row.createSpan({ cls: 'vw-modal-doc-icon' });
			setIcon(iconEl, 'file-text');

			const fileName = docPath.split('/').pop()?.replace(/\.md$/, '') ?? docPath;
			const nameEl = row.createSpan({ cls: 'vw-modal-doc-name', text: fileName });
			attachOverflowTooltip(nameEl, docPath);

			nameEl.addEventListener('click', (e) => {
				e.stopPropagation();
				const file = this.app.vault.getAbstractFileByPath(docPath);
				if (file instanceof TFile) {
					this.app.workspace.openLinkText(docPath, '', false);
				}
			});

			const removeBtn = row.createDiv({ cls: 'vw-modal-subtask-remove' });
			setIcon(removeBtn, 'x');
			removeBtn.setAttribute('aria-label', 'Unlink document');
			removeBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				this.pendingLinkedDocs = this.pendingLinkedDocs.filter((p) => p !== docPath);
				this.refreshLinkedDocsList();
			});
		}
	}

	private showCreateDocInput(parent: HTMLElement): void {
		const existing = parent.querySelector('.vw-modal-docs-create-input');
		if (existing) { existing.remove(); return; }

		const row = parent.createDiv({ cls: 'vw-modal-docs-create-input' });
		const input = row.createEl('input', {
			cls: 'vw-modal-subtask-input',
			attr: { type: 'text', placeholder: 'Document name (e.g. Notes/My Doc)' },
		});

		input.addEventListener('keydown', async (e: KeyboardEvent) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				const raw = input.value.trim();
				if (raw === '') return;

				const path = normalizePath(raw.endsWith('.md') ? raw : `${raw}.md`);
				const existingFile = this.app.vault.getAbstractFileByPath(path);

				if (existingFile instanceof TFile) {
					if (this.pendingLinkedDocs.includes(path) === false) {
						this.pendingLinkedDocs.push(path);
					}
				} else {
					const dir = path.substring(0, path.lastIndexOf('/'));
					if (dir && this.app.vault.getAbstractFileByPath(dir) === null) {
						await this.app.vault.createFolder(dir);
					}
					await this.app.vault.create(path, '');
					this.pendingLinkedDocs.push(path);
				}

				this.refreshLinkedDocsList();
				row.remove();
			} else if (e.key === 'Escape') {
				e.preventDefault();
				row.remove();
			}
		});

		requestAnimationFrame(() => input.focus());
	}

	private showChildInput(parent: HTMLElement, sub: SubTask, depth: number): void {
		const existing = parent.querySelector('.vw-modal-subtask-child-input');
		if (existing) { existing.remove(); return; }

		const form = parent.createDiv({ cls: 'vw-modal-subtask-child-input' });
		const input = form.createEl('input', {
			cls: 'vw-modal-subtask-input',
			attr: { type: 'text', placeholder: 'Subtask title' },
		});

		input.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				const title = input.value.trim();
				if (title === '') return;
				if (sub.subtasks === undefined) sub.subtasks = [];
				sub.subtasks.push({
					id: `_new_${Date.now().toString(36)}${Math.random().toString(36).substring(2, 6)}`,
					title,
					status: 'pending',
				});
				input.value = '';
				this.refreshSubtaskList();
			} else if (e.key === 'Escape') {
				e.preventDefault();
				form.remove();
			}
		});

		requestAnimationFrame(() => input.focus());
	}
}
