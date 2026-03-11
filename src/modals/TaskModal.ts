/*
 * Author: Miguel A. Lopez
 * Company: Rank Up Games LLC
 * Project: Vault Dashboard Welcome
 * Description: Unified add/edit task modal with subtask bulk entry
 * Created: 2026-03-07
 * Last Modified: 2026-03-10
 */

import { App, Modal, Notice, Platform, setIcon, TFile, normalizePath } from 'obsidian';
import { Task, SubTask, PluginSettings, IMAGE_EXTENSIONS, isImageExtension } from '../core/types';
import { attachOverflowTooltip } from '../ui/Tooltip';
import { DropZone } from '../ui/DropZone';
import { FileSuggestModal } from './FileSuggestModal';
import { ConfirmModal } from './ConfirmModal';
import { isAIEnabled, gatherContext, type IAIDispatcher } from '../services/AIDispatcher';
import { TaskManager } from '../core/TaskManager';
import { ensureVaultFolder } from '../services/VaultUtils';

const MAX_SUBTASK_DEPTH = 4;

const cloneSubtasks = (subs: SubTask[]): SubTask[] =>
	subs.map((s) => ({
		...s,
		subtasks: s.subtasks ? cloneSubtasks(s.subtasks) : undefined,
	}));

/** Values returned when the task modal is saved. */
export interface TaskModalResult {
	/** Task title entered by the user. */
	title: string;
	/** Optional extended description for AI context. */
	description?: string;
	/** Estimated duration in minutes. */
	durationMinutes: number;
	/** Subtask hierarchy, if any. */
	subtasks?: SubTask[];
	/** Tag strings attached to the task. */
	tags?: string[];
	/** Vault paths to linked documents. */
	linkedDocs?: string[];
	/** Vault paths to attached images. */
	images?: string[];
	/** Per-task working directory for AI CLI execution. */
	workingDirectory?: string;
}

/** Unified add/edit task modal with subtask bulk entry, tags, linked docs, and images. */
export class TaskModal extends Modal {
	private task: Task | null;
	private settings: PluginSettings;
	private knownTags: string[];
	private onSave: (result: TaskModalResult) => void;
	private pendingSubtasks: SubTask[] = [];
	private pendingTags: string[] = [];
	private pendingLinkedDocs: string[] = [];
	private pendingImages: string[] = [];
	private pendingWorkingDir = '';
	private subtaskListEl: HTMLElement | null = null;
	private tagSuggestEl: HTMLElement | null = null;
	private attachmentsListEl: HTMLElement | null = null;
	private dragSub: { arr: SubTask[]; idx: number } | null = null;
	private dropZones: DropZone[] = [];
	private taskManager: TaskManager | null = null;
	private aiDispatcher: IAIDispatcher | null = null;
	private saved = false;
	private initialTitle = '';
	private initialDesc = '';
	private initialWorkingDir = '';
	private initialDurMinutes = 0;
	private initialSubtasksJson = '[]';
	private initialTags = '[]';
	private initialDocs = '[]';
	private initialImages = '[]';
	private titleInputRef: HTMLInputElement | null = null;
	private descInputRef: HTMLTextAreaElement | null = null;
	private wdPathEl: HTMLElement | null = null;
	private durGetter: (() => number) | null = null;
	private tmplCloseHandler: ((e: MouseEvent) => void) | null = null;

	/**
	 * @param app - Obsidian app instance
	 * @param task - Existing task to edit, or null for add
	 * @param settings - Plugin settings (templates, tag colors, etc.)
	 * @param onSave - Callback invoked with result when user saves
	 * @param knownTags - Known tags for suggestion dropdown
	 * @param taskManager - Optional task manager for AI features
	 * @param aiDispatcher - Optional AI dispatcher for context gathering
	 */
	constructor(app: App, task: Task | null, settings: PluginSettings, onSave: (result: TaskModalResult) => void, knownTags: string[] = [], taskManager: TaskManager | null = null, aiDispatcher: IAIDispatcher | null = null) {
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
		if (task?.images) {
			this.pendingImages = [...task.images];
		}
		this.pendingWorkingDir = task?.workingDirectory ?? '';
		this.taskManager = taskManager;
		this.aiDispatcher = aiDispatcher;
	}

	/** @override */
	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass('vw-task-edit-modal');
		this.modalEl.querySelector('.modal-close-button')?.remove();

		const isEdit = this.task !== null;
		contentEl.createEl('h3', { text: isEdit ? 'Edit Task' : 'Add Task' });

		const form = contentEl.createDiv({ cls: 'vw-edit-form' });

		let durHours: number;
		let durMins: number;

		form.createDiv({ cls: 'vw-edit-label', text: 'Title' });
		const titleInput = form.createEl('input', {
			cls: 'vw-edit-input',
			attr: { type: 'text', value: this.task?.title ?? '', placeholder: 'Task title' },
		});

		form.createDiv({ cls: 'vw-edit-label', text: 'Description' });
		const descInput = form.createEl('textarea', {
			cls: 'vw-edit-textarea',
			attr: { rows: '3', placeholder: 'Optional description (used as AI instruction context)' },
		});
		descInput.value = this.task?.description ?? '';

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
		durRow.createDiv({ cls: 'vw-dur-sep', text: ':' });
		buildStepper(minsDisplay, 'm', (d) => stepMins(d * 5));
		updateDurDisplay();

		form.createDiv({ cls: 'vw-edit-label', text: 'Tags' });

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

		const attachSection = form.createDiv({ cls: 'vw-modal-docs-section' });
		attachSection.createDiv({ cls: 'vw-edit-label', text: 'Attachments' });

		const allExtensions: string[] = ['md', 'txt', ...IMAGE_EXTENSIONS];
		const attachDropZone = new DropZone(attachSection, {
			accept: { extensions: allExtensions, mimeTypes: ['image/*'], text: true },
			callbacks: {
				onExternalFiles: async (files) => {
					for (const file of files) {
						const path = await this.saveFileToVault(file);
						if (path === null) continue;
						const ext = path.split('.').pop() ?? '';
						if (isImageExtension(ext)) {
							if (this.pendingImages.includes(path) === false) this.pendingImages.push(path);
						} else {
							if (this.pendingLinkedDocs.includes(path) === false) this.pendingLinkedDocs.push(path);
						}
					}
					this.refreshAttachmentsList();
				},
				onVaultPaths: (paths) => {
					for (const p of paths) {
						const ext = p.split('.').pop() ?? '';
						if (isImageExtension(ext)) {
							if (this.pendingImages.includes(p) === false) this.pendingImages.push(p);
						} else {
							if (this.pendingLinkedDocs.includes(p) === false) this.pendingLinkedDocs.push(p);
						}
					}
					this.refreshAttachmentsList();
				},
				onText: async (text) => {
					await this.linkOrCreateFromText(text);
				},
			},
			label: 'Drop files or paste a vault path',
			icon: 'file-text',
		});
		attachDropZone.bindPaste(contentEl);
		this.dropZones.push(attachDropZone);

		const attachActions = attachSection.createDiv({ cls: 'vw-modal-docs-actions' });

		const linkExistingBtn = attachActions.createEl('button', { cls: 'vw-attach-chip' });
		const linkIcon = linkExistingBtn.createSpan({ cls: 'vw-btn-icon' });
		setIcon(linkIcon, 'link');
		linkExistingBtn.createSpan({ text: ' Link Existing' });
		linkExistingBtn.addEventListener('click', (e) => {
			e.preventDefault();
			new FileSuggestModal(this.app, (file: TFile) => {
				if (this.pendingLinkedDocs.includes(file.path) === false) {
					this.pendingLinkedDocs.push(file.path);
					this.refreshAttachmentsList();
				}
			}).open();
		});

		const createNewBtn = attachActions.createEl('button', { cls: 'vw-attach-chip' });
		const createIcon = createNewBtn.createSpan({ cls: 'vw-btn-icon' });
		setIcon(createIcon, 'file-plus');
		createNewBtn.createSpan({ text: ' Create New' });
		createNewBtn.addEventListener('click', (e) => {
			e.preventDefault();
			this.showCreateDocInput(attachSection);
		});

		const attachImgBtn = attachActions.createEl('button', { cls: 'vw-attach-chip' });
		const attachImgIcon = attachImgBtn.createSpan({ cls: 'vw-btn-icon' });
		setIcon(attachImgIcon, 'image');
		attachImgBtn.createSpan({ text: ' Attach Image' });
		attachImgBtn.addEventListener('click', (e) => {
			e.preventDefault();
			new FileSuggestModal(this.app, (file: TFile) => {
				if (this.pendingImages.includes(file.path) === false) {
					this.pendingImages.push(file.path);
					this.refreshAttachmentsList();
				}
			}, [...IMAGE_EXTENSIONS]).open();
		});

		this.attachmentsListEl = attachSection.createDiv({ cls: 'vw-modal-docs-list' });
		this.refreshAttachmentsList();

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
		const actionsLeft = actions.createDiv({ cls: 'vw-edit-actions-left' });
		const actionsRight = actions.createDiv({ cls: 'vw-edit-actions-right' });

		if (isEdit === false) {
			const tmplWrap = actionsLeft.createDiv({ cls: 'vw-tmpl-wrap' });
			const tmplBtn = tmplWrap.createEl('button', {
				cls: 'vw-icon-btn vw-tmpl-trigger',
				attr: { 'aria-label': 'Load from template', tabindex: '0' },
			});
			const tmplBtnIcon = tmplBtn.createSpan({ cls: 'vw-btn-icon' });
			setIcon(tmplBtnIcon, 'layers');
			tmplBtn.createSpan({ cls: 'vw-tmpl-label', text: 'Template' });

			const tmplDropdown = tmplWrap.createDiv({ cls: 'vw-tmpl-dropdown' });
			if (this.settings.templates.length === 0) {
				tmplDropdown.createDiv({ cls: 'vw-tmpl-empty', text: 'No templates yet' });
			} else {
				for (const tmpl of this.settings.templates) {
					const opt = tmplDropdown.createDiv({ cls: 'vw-tmpl-option' });
					opt.createSpan({ text: tmpl.name });
					opt.createSpan({ cls: 'vw-tmpl-option-dur', text: `${tmpl.durationMinutes}m` });
					opt.addEventListener('click', () => {
						titleInput.value = tmpl.name;
						durHours = Math.floor(tmpl.durationMinutes / 60);
						durMins = tmpl.durationMinutes % 60;
						updateDurDisplay();
						if (tmpl.tags) { this.pendingTags = [...tmpl.tags]; this.refreshTagSuggestions(''); }
						if (tmpl.subtasks) { this.pendingSubtasks = cloneSubtasks(tmpl.subtasks); this.refreshSubtaskList(); }
						tmplDropdown.classList.remove('vw-tmpl-dropdown-open');
					});
				}
			}

			tmplBtn.addEventListener('click', (e) => {
				e.preventDefault();
				e.stopPropagation();
				tmplDropdown.classList.toggle('vw-tmpl-dropdown-open');
			});

			this.tmplCloseHandler = (e: MouseEvent) => {
				if (tmplWrap.contains(e.target as Node) === false) {
					tmplDropdown.classList.remove('vw-tmpl-dropdown-open');
				}
			};
			document.addEventListener('click', this.tmplCloseHandler);
		}

		if (isAIEnabled(this.settings) && this.taskManager) {
			const aiBtn = actionsLeft.createEl('button', {
				cls: 'vw-icon-btn',
				attr: { 'aria-label': 'AI: Auto-gather context and attach', tabindex: '0' },
			});
			setIcon(aiBtn, 'sparkles');
			aiBtn.addEventListener('click', async (e) => {
				e.preventDefault();
				if (this.taskManager === null) return;
				const title = titleInput.value.trim();
				const desc = descInput.value.trim();
				if (title === '' && desc === '') {
					new Notice('Add a title or description first');
					return;
				}
				aiBtn.disabled = true;
				const ctx = await gatherContext(this.taskManager, this.app);
				let added = 0;
				for (const docPath of ctx.linkedDocContents.keys()) {
					if (this.pendingLinkedDocs.includes(docPath) === false) {
						this.pendingLinkedDocs.push(docPath);
						added++;
					}
				}
				for (const imgPath of ctx.imagePaths) {
					if (this.pendingImages.includes(imgPath) === false) {
						this.pendingImages.push(imgPath);
						added++;
					}
				}
				this.refreshAttachmentsList();
				new Notice(added > 0 ? `Auto-attached ${added} item(s)` : 'No new attachments found');
				aiBtn.disabled = false;
			});
		}

		const wdBtn = actionsLeft.createEl('button', {
			cls: 'vw-icon-btn',
			attr: { 'aria-label': 'Set working directory for AI execution', tabindex: '0' },
		});
		setIcon(wdBtn, 'folder-open');
		const wdPathSpan = actionsLeft.createSpan({ cls: 'vw-wd-path' });
		this.wdPathEl = wdPathSpan;
		this.updateWdPathDisplay();
		wdBtn.addEventListener('click', async (e) => {
			e.preventDefault();
			if (Platform.isDesktop === false) {
				new Notice('Folder picker is only available on desktop');
				return;
			}
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			const electron = require('electron');
			const remote = electron?.remote;
			if (remote?.dialog?.showOpenDialog) {
				const result = await remote.dialog.showOpenDialog({
					title: 'Select Working Directory',
					properties: ['openDirectory'],
					defaultPath: this.pendingWorkingDir || undefined,
				});
				if (result.canceled || result.filePaths.length === 0) return;
				this.pendingWorkingDir = result.filePaths[0];
				this.updateWdPathDisplay();
			} else {
				this.showWorkingDirInput(actionsLeft);
			}
		});

		if (isEdit) {
			const tmplBtn = actionsRight.createEl('button', { cls: 'vw-timer-btn', text: 'Save as Template' });
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

		const saveBtn = actionsRight.createEl('button', { cls: 'vw-timer-btn vw-timer-btn-primary', text: 'Save' });
		const cancelBtn = actionsRight.createEl('button', { cls: 'vw-timer-btn', text: 'Cancel' });

		const doSave = (): void => {
			const title = titleInput.value.trim();
			if (title === '') return;
			const desc = descInput.value.trim();
			const wd = this.pendingWorkingDir;
			this.saved = true;
			this.onSave({
				title,
				description: desc || undefined,
				durationMinutes: Math.max(durHours * 60 + durMins, 5),
				subtasks: this.pendingSubtasks.length > 0 ? this.pendingSubtasks : undefined,
				tags: this.pendingTags.length > 0 ? [...this.pendingTags] : undefined,
				linkedDocs: this.pendingLinkedDocs.length > 0 ? [...this.pendingLinkedDocs] : undefined,
				images: this.pendingImages.length > 0 ? [...this.pendingImages] : undefined,
				workingDirectory: wd || undefined,
			});
			this.close();
		};

		saveBtn.addEventListener('click', doSave);
		cancelBtn.addEventListener('click', () => this.close());

		titleInput.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter') { e.preventDefault(); doSave(); }
		});

		this.titleInputRef = titleInput;
		this.descInputRef = descInput;
		this.durGetter = () => durHours * 60 + durMins;
		this.initialTitle = titleInput.value;
		this.initialDesc = descInput.value;
		this.initialWorkingDir = this.pendingWorkingDir;
		this.initialDurMinutes = durHours * 60 + durMins;
		this.initialSubtasksJson = JSON.stringify(this.pendingSubtasks);
		this.initialTags = JSON.stringify(this.pendingTags);
		this.initialDocs = JSON.stringify(this.pendingLinkedDocs);
		this.initialImages = JSON.stringify(this.pendingImages);

		requestAnimationFrame(() => {
			titleInput.focus();
			if (isEdit) titleInput.select();
		});
	}

	private isDirty(): boolean {
		if (this.titleInputRef === null) return false;
		if (this.titleInputRef.value !== this.initialTitle) return true;
		if (this.descInputRef && this.descInputRef.value !== this.initialDesc) return true;
		if (this.pendingWorkingDir !== this.initialWorkingDir) return true;
		if (this.durGetter && this.durGetter() !== this.initialDurMinutes) return true;
		if (JSON.stringify(this.pendingSubtasks) !== this.initialSubtasksJson) return true;
		if (JSON.stringify(this.pendingTags) !== this.initialTags) return true;
		if (JSON.stringify(this.pendingLinkedDocs) !== this.initialDocs) return true;
		if (JSON.stringify(this.pendingImages) !== this.initialImages) return true;
		return false;
	}

	private updateWdPathDisplay(): void {
		if (this.wdPathEl === null) return;
		if (this.pendingWorkingDir) {
			const basename = this.pendingWorkingDir.split('/').pop() ?? this.pendingWorkingDir;
			this.wdPathEl.setText(basename);
			this.wdPathEl.setAttribute('aria-label', this.pendingWorkingDir);
			this.wdPathEl.style.display = '';
		} else {
			this.wdPathEl.setText('');
			this.wdPathEl.style.display = 'none';
		}
	}

	/** @override — intercepts Escape / outside-click / Cancel to guard unsaved changes. */
	close(): void {
		if (this.saved || this.isDirty() === false) {
			super.close();
			return;
		}
		new ConfirmModal(this.app, 'Discard Changes', 'You have unsaved changes. Discard them?', () => {
			this.saved = true;
			super.close();
		}, 'Discard').open();
	}

	/** @override */
	onClose(): void {
		if (this.tmplCloseHandler) {
			document.removeEventListener('click', this.tmplCloseHandler);
			this.tmplCloseHandler = null;
		}
		for (const dz of this.dropZones) dz.destroy();
		this.dropZones = [];
		this.contentEl.empty();
	}

	private refreshTagSuggestions(filter: string): void {
		if (this.tagSuggestEl === null) return;
		this.tagSuggestEl.empty();

		const visible = this.knownTags.filter((t) => filter === '' || t.includes(filter));

		if (visible.length === 0) {
			this.tagSuggestEl.style.display = 'none';
			return;
		}

		this.tagSuggestEl.style.display = 'flex';
		for (const tag of visible) {
			const selected = this.pendingTags.includes(tag);
			const chip = this.tagSuggestEl.createSpan({
				cls: `vw-tag-suggest-chip${selected ? ' vw-tag-suggest-chip-active' : ''}`,
				text: tag,
			});
			const color = this.settings.tagColors[tag];
			if (selected && color) {
				chip.style.backgroundColor = color;
				chip.style.borderColor = color;
			} else if (color) {
				chip.style.borderColor = color;
			}
			chip.addEventListener('click', () => {
				if (selected) {
					this.pendingTags = this.pendingTags.filter((t) => t !== tag);
				} else {
					this.pendingTags.push(tag);
				}
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

	private refreshAttachmentsList(): void {
		if (this.attachmentsListEl === null) return;
		this.attachmentsListEl.empty();

		const hasAny = this.pendingLinkedDocs.length > 0 || this.pendingImages.length > 0;
		if (hasAny === false) {
			this.attachmentsListEl.createDiv({ cls: 'vw-modal-docs-empty', text: 'No attachments' });
			return;
		}

		for (const docPath of this.pendingLinkedDocs) {
			const row = this.attachmentsListEl.createDiv({ cls: 'vw-modal-doc-row' });
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
				this.refreshAttachmentsList();
			});
		}

		for (const imgPath of this.pendingImages) {
			const row = this.attachmentsListEl.createDiv({ cls: 'vw-modal-doc-row' });
			const iconEl = row.createSpan({ cls: 'vw-modal-doc-icon' });
			setIcon(iconEl, 'image');
			const fileName = imgPath.split('/').pop() ?? imgPath;
			row.createSpan({ cls: 'vw-modal-doc-name', text: fileName });
			const removeBtn = row.createDiv({ cls: 'vw-modal-subtask-remove' });
			setIcon(removeBtn, 'x');
			removeBtn.setAttribute('aria-label', 'Remove image');
			removeBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				this.pendingImages = this.pendingImages.filter((p) => p !== imgPath);
				this.refreshAttachmentsList();
			});
		}
	}

	private showCreateDocInput(parent: HTMLElement): void {
		const existing = parent.querySelector('.vw-modal-docs-create-panel');
		if (existing) { existing.remove(); return; }

		const panel = parent.createDiv({ cls: 'vw-modal-docs-create-panel' });

		const titleInput = panel.createEl('input', {
			cls: 'vw-edit-input',
			attr: { type: 'text', placeholder: 'Document name (e.g. Notes/My Doc)' },
		});

		const contentArea = panel.createEl('textarea', {
			cls: 'vw-edit-textarea vw-create-doc-content',
			attr: { rows: '12', placeholder: 'Document content (markdown)' },
		});

		const btnRow = panel.createDiv({ cls: 'vw-create-doc-actions' });
		const createBtn = btnRow.createEl('button', { cls: 'vw-timer-btn vw-timer-btn-primary vw-timer-btn-sm', text: 'Create' });
		const cancelBtn = btnRow.createEl('button', { cls: 'vw-timer-btn vw-timer-btn-sm', text: 'Cancel' });

		const doCreate = async (): Promise<void> => {
			const raw = titleInput.value.trim();
			if (raw === '') return;

			const path = normalizePath(raw.endsWith('.md') ? raw : `${raw}.md`);
			const content = contentArea.value;
			const existingFile = this.app.vault.getAbstractFileByPath(path);

			if (existingFile instanceof TFile) {
				if (content) {
					await this.app.vault.modify(existingFile, content);
				}
				if (this.pendingLinkedDocs.includes(path) === false) {
					this.pendingLinkedDocs.push(path);
				}
			} else {
				const dir = path.substring(0, path.lastIndexOf('/'));
				if (dir && this.app.vault.getAbstractFileByPath(dir) === null) {
					await this.app.vault.createFolder(dir);
				}
				await this.app.vault.create(path, content);
				this.pendingLinkedDocs.push(path);
			}

			this.refreshAttachmentsList();
			panel.remove();
		};

		createBtn.addEventListener('click', (e) => { e.preventDefault(); doCreate(); });
		cancelBtn.addEventListener('click', (e) => { e.preventDefault(); panel.remove(); });

		titleInput.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Escape') { e.preventDefault(); panel.remove(); }
		});
		contentArea.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Escape') { e.preventDefault(); panel.remove(); }
		});

		requestAnimationFrame(() => titleInput.focus());
	}

	private showChildInput(parent: HTMLElement, sub: SubTask, _depth: number): void {
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

	/** Fallback text input for working directory when electron.remote is unavailable. */
	private showWorkingDirInput(parent: HTMLElement): void {
		const existing = parent.querySelector('.vw-wd-input-panel');
		if (existing) { existing.remove(); return; }

		const panel = parent.createDiv({ cls: 'vw-wd-input-panel' });
		const input = panel.createEl('input', {
			cls: 'vw-edit-input',
			attr: { type: 'text', placeholder: '/absolute/path/to/directory', value: this.pendingWorkingDir },
		});
		const saveBtn = panel.createEl('button', { cls: 'vw-timer-btn vw-timer-btn-sm', text: 'Set' });
		const cancelBtn = panel.createEl('button', { cls: 'vw-timer-btn vw-timer-btn-sm', text: 'Cancel' });

		saveBtn.addEventListener('click', (e) => {
			e.preventDefault();
			const val = input.value.trim();
			if (val) this.pendingWorkingDir = val;
			this.updateWdPathDisplay();
			panel.remove();
		});
		cancelBtn.addEventListener('click', (e) => { e.preventDefault(); panel.remove(); });
		input.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Escape') { e.preventDefault(); panel.remove(); }
			if (e.key === 'Enter') { e.preventDefault(); saveBtn.click(); }
		});

		requestAnimationFrame(() => input.focus());
	}

	/**
	 * Saves a clipboard blob (e.g. pasted screenshot) to the vault
	 * and returns its vault-relative path.
	 */
	private async saveBlobToVault(blob: Blob, mimeType: string): Promise<string | null> {
		const ext = mimeType.split('/').pop()?.replace('jpeg', 'jpg') ?? 'png';
		const name = `pasted-${Date.now().toString(36)}.${ext}`;
		return this.writeAttachment(name, await blob.arrayBuffer());
	}

	/**
	 * Saves an external File (dropped from OS) to the vault
	 * and returns its vault-relative path.
	 */
	private async saveFileToVault(file: File): Promise<string | null> {
		return this.writeAttachment(file.name, await file.arrayBuffer());
	}

	/** Writes binary data to the vault's attachments folder, returning the path. */
	private async writeAttachment(name: string, data: ArrayBuffer): Promise<string | null> {
		const folder = normalizePath(`${this.settings.outputFolder}/attachments`);
		await ensureVaultFolder(this.app, folder);
		let path = normalizePath(`${folder}/${name}`);
		if (this.app.vault.getAbstractFileByPath(path)) {
			const dot = name.lastIndexOf('.');
			const baseName = dot > 0 ? name.substring(0, dot) : name;
			const ext = dot > 0 ? name.substring(dot) : '';
			path = normalizePath(`${folder}/${baseName}-${Date.now().toString(36)}${ext}`);
		}
		const file = await this.app.vault.createBinary(path, data).catch((): null => null);
		return file ? path : null;
	}

	/**
	 * Handles pasted text in the documents zone: links an existing vault file
	 * if the text matches a path, otherwise creates a new note with the content.
	 */
	private async linkOrCreateFromText(text: string): Promise<void> {
		const trimmed = text.replace(/\n/g, ' ').trim();
		const normalized = normalizePath(trimmed.endsWith('.md') ? trimmed : `${trimmed}.md`);
		const existing = this.app.vault.getAbstractFileByPath(normalized);

		if (existing instanceof TFile) {
			if (this.pendingLinkedDocs.includes(normalized) === false) {
				this.pendingLinkedDocs.push(normalized);
			}
		} else {
			const docsFolder = normalizePath(`${this.settings.outputFolder}/documents`);
			await ensureVaultFolder(this.app, docsFolder);
			const slug = trimmed.substring(0, 60).replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, '-');
			const path = normalizePath(`${docsFolder}/${slug}.md`);
			const created = await this.app.vault.create(path, text).catch((): null => null);
			if (created === null) return;
			this.pendingLinkedDocs.push(path);
		}
		this.refreshAttachmentsList();
	}
}
