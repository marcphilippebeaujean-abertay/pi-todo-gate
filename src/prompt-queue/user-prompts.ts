import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import {
	DIRTY_CONFIRM_PREFIX,
	DIRTY_CONFIRM_SUFFIX,
	DIRTY_CONFIRM_TITLE,
	EXIT_ACTION_FAILED,
	EXIT_ACTION_KEY,
	EXIT_CANCEL_KEY,
	EXIT_CANCEL_LABEL,
	EXIT_SUBMIT_KEY,
	EXIT_SUBMIT_LABEL,
	EXIT_TAB_KEY,
	EXIT_TITLE,
	EXIT_TUI_MODE,
	MERGE_CONFIRM_MESSAGE,
	MERGE_CONFIRM_TITLE_PREFIX,
	REMOVE_WORKTREE_ACTION_ID,
	TODOIST_CONFIRM_MESSAGE_PREFIX,
	TODOIST_CONFIRM_PREFIX,
	TODOIST_CONFIRM_SUFFIX,
} from "./constants.ts";
import type {
	CustomUI,
	ExitAction,
	PickerFocus,
	PickerState,
	PickerTUI,
	TodoistCompletionSnapshot,
} from "./internal-state.ts";
import { initialPickerState, toggleAction } from "./internal-state.ts";

export function confirmMerge(
	context: ExtensionContext,
	prUrl: string,
): Promise<boolean> {
	return context.ui.confirm(
		`${MERGE_CONFIRM_TITLE_PREFIX}${prUrl}?`,
		MERGE_CONFIRM_MESSAGE,
	);
}

export function confirmTodoistCompletion(
	context: ExtensionContext,
	snapshot: TodoistCompletionSnapshot,
): Promise<boolean> {
	return context.ui.confirm(
		`${TODOIST_CONFIRM_PREFIX}${snapshot.taskName}${TODOIST_CONFIRM_SUFFIX}`,
		`${TODOIST_CONFIRM_MESSAGE_PREFIX}${snapshot.taskRef}`,
	);
}

export function confirmDirtyWorktree(
	context: ExtensionContext,
	worktreePath: string,
): Promise<boolean> {
	return context.ui.confirm(
		DIRTY_CONFIRM_TITLE,
		`${DIRTY_CONFIRM_PREFIX}${worktreePath}${DIRTY_CONFIRM_SUFFIX}`,
	);
}

class PickerWidget {
	private readonly picker: ExitActionPicker;
	private readonly tui: PickerTUI;

	constructor(
		tui: PickerTUI,
		actions: readonly ExitAction[],
		done: (result: readonly string[] | null) => void,
	) {
		this.tui = tui;
		this.picker = new ExitActionPicker(actions, done);
	}

	render(width: number): string[] {
		return this.picker.render(width);
	}

	handleInput(data: string): void {
		this.picker.handleInput(data);
		this.tui.requestRender();
	}

	invalidate(): void {}
}

export function pickWithCustomUI(
	custom: CustomUI,
	actions: readonly ExitAction[],
): Promise<readonly string[] | null> {
	return custom<readonly string[] | null>(
		(tui, _theme, _keybindings, done) => new PickerWidget(tui, actions, done),
	);
}

export class ExitActionPicker {
	private state: PickerState;

	constructor(
		private readonly actions: readonly ExitAction[],
		private readonly done: (result: readonly string[] | null) => void,
	) {
		this.state = initialPickerState(actions.map((action) => action.id));
	}

	render(width: number): string[] {
		const rows: string[] = [EXIT_TITLE, ""];
		for (const action of this.actions) {
			const focused = this.state.focused;
			const isFocused = typeof focused === "object" && focused.id === action.id;
			const marker = isFocused ? ">" : " ";
			const isSelected = this.state.selectedIds.has(action.id);
			const checkmark = isSelected ? "x" : " ";
			rows.push(`${marker} [${checkmark}] ${action.label}`);
		}
		rows.push("");
		const focused = this.state.focused;
		const isSubmitFocused = focused === EXIT_SUBMIT_KEY;
		const isCancelFocused = focused === EXIT_CANCEL_KEY;
		rows.push(
			`${isSubmitFocused ? ">" : " "} ${EXIT_SUBMIT_LABEL}    ${isCancelFocused ? ">" : " "} ${EXIT_CANCEL_LABEL}`,
		);
		return rows.map((row) => truncateToWidth(row, width, ""));
	}

	handleInput(data: string): void {
		switch (true) {
			case matchesKey(data, Key.tab) || matchesKey(data, Key.down):
				this.moveFocus(1);
				return;
			case matchesKey(data, Key.shift(EXIT_TAB_KEY)) ||
				matchesKey(data, Key.up):
				this.moveFocus(-1);
				return;
			case matchesKey(data, Key.space):
				this.toggleFocusedAction();
				return;
			case matchesKey(data, Key.enter):
				this.submitFocusedTarget();
				return;
			case matchesKey(data, Key.escape):
				this.done(null);
				return;
			default:
				return;
		}
	}

	private toggleFocusedAction(): void {
		const focused = this.state.focused;
		if (typeof focused !== "object") return;
		this.state = toggleAction(this.state, focused.id);
	}

	private submitFocusedTarget(): void {
		switch (this.state.focused) {
			case EXIT_SUBMIT_KEY:
				this.done([...this.state.selectedIds]);
				return;
			case EXIT_CANCEL_KEY:
				this.done(null);
				return;
			default:
				this.toggleFocusedAction();
		}
	}

	private moveFocus(direction: 1 | -1): void {
		const targets: PickerFocus[] = [
			...this.actions.map(
				(action) => ({ type: EXIT_ACTION_KEY, id: action.id }) as const,
			),
			EXIT_SUBMIT_KEY,
			EXIT_CANCEL_KEY,
		];
		const index = targets.findIndex((target) => this.isSameFocus(target));
		const next = targets[(index + direction + targets.length) % targets.length];
		if (next !== undefined) this.state = { ...this.state, focused: next };
	}

	private isSameFocus(target: PickerFocus): boolean {
		const targetId = typeof target === "object" ? target.id : undefined;
		const focusedId =
			typeof this.state.focused === "object"
				? this.state.focused.id
				: undefined;
		const hasObjectFocus = targetId !== undefined || focusedId !== undefined;
		if (hasObjectFocus) return targetId === focusedId;
		return target === this.state.focused;
	}
}

function selectedActions(
	actions: readonly ExitAction[],
	selected: readonly string[] | null,
): readonly ExitAction[] {
	if (selected === null) return [];
	const selectedIds = new Set(selected);
	return actions.filter((action) => selectedIds.has(action.id));
}

async function pickActions(
	context: ExtensionContext,
	actions: readonly ExitAction[],
): Promise<readonly string[] | null> {
	const custom = context.ui.custom;
	const canUseCustomPicker =
		context.mode === EXIT_TUI_MODE && typeof custom === "function";
	if (canUseCustomPicker) return pickWithCustomUI(custom, actions);
	const selected: string[] = [];
	for (const action of actions) {
		const confirmed = await context.ui.confirm(EXIT_TITLE, action.label);
		if (confirmed) selected.push(action.id);
	}
	return selected;
}

async function executeAction(
	context: ExtensionContext,
	action: ExitAction,
	isCurrent: () => boolean,
): Promise<boolean> {
	const isCurrentBeforeAction = isCurrent();
	if (!isCurrentBeforeAction) return false;
	try {
		await action.execute();
		return true;
	} catch (error) {
		const isCurrentAfterAction = isCurrent();
		if (!isCurrentAfterAction) return false;
		const detail = error instanceof Error ? error.message : String(error);
		try {
			context.ui.notify(`${EXIT_ACTION_FAILED}${detail}`, "warning");
		} catch {
			return false;
		}
		return true;
	}
}

export async function presentExitActions(
	context: ExtensionContext | null,
	actions: readonly ExitAction[],
	isCurrent: () => boolean,
): Promise<void> {
	const hasContext = context !== null;
	const canPrompt = hasContext && context.hasUI;
	const hasActions = actions.length > 0;
	const canPresent = canPrompt && hasActions;
	if (!canPresent) return;
	const selected = await pickActions(context, actions);
	const isCurrentAfterPrompt = isCurrent();
	if (!isCurrentAfterPrompt) return;
	for (const action of selectedActions(actions, selected)) {
		const shouldContinue = await executeAction(context, action, isCurrent);
		if (!shouldContinue) return;
	}
}

export function worktreeAction(
	worktreePath: string,
	branch: string,
	execute: () => Promise<import("../shared/exit-actions.ts").ExitActionResult>,
): ExitAction {
	return {
		id: REMOVE_WORKTREE_ACTION_ID,
		label: `Delete worktree "${worktreePath}" and local branch "${branch}"`,
		execute,
	};
}
