import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import {
	EXIT_ACTION_KEY,
	EXIT_CANCEL_KEY,
	EXIT_CANCEL_LABEL,
	EXIT_EMPTY,
	EXIT_FOCUSED,
	EXIT_SELECTED,
	EXIT_SUBMIT_KEY,
	EXIT_SUBMIT_LABEL,
	EXIT_TAB_KEY,
	EXIT_TITLE,
	EXIT_TUI_MODE,
	EXIT_UNFOCUSED,
	EXIT_UNSELECTED,
} from "./constants.ts";
import { executeExitAction } from "./notifications.ts";
import type { ExitAction } from "./state.ts";
import {
	type CustomUI,
	type ExitPickerResult,
	initialPickerState,
	type PickerFocus,
	type PickerState,
	type PickerTUI,
	toggleAction,
} from "./state.ts";

class PickerWidget {
	private readonly picker: ExitActionPicker;
	private readonly tui: PickerTUI;

	constructor(
		tui: PickerTUI,
		actions: readonly ExitAction[],
		done: (result: ExitPickerResult) => void,
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
): Promise<ExitPickerResult> {
	return custom<ExitPickerResult>(
		(tui, _theme, _keybindings, done) => new PickerWidget(tui, actions, done),
	);
}

export class ExitActionPicker {
	private state: PickerState;
	private readonly actions: readonly ExitAction[];
	private readonly done: (result: ExitPickerResult) => void;

	constructor(
		actions: readonly ExitAction[],
		done: (result: ExitPickerResult) => void,
	) {
		this.actions = actions;
		this.state = initialPickerState(actions.map((action) => action.id));
		this.done = done;
	}

	render(width: number): string[] {
		const rows: string[] = [EXIT_TITLE, EXIT_EMPTY];
		for (const action of this.actions) {
			const isFocused =
				typeof this.state.focused === "object" &&
				this.state.focused.id === action.id;
			const marker = isFocused ? EXIT_FOCUSED : EXIT_UNFOCUSED;
			const isSelected = this.state.selectedIds.has(action.id);
			const checkmark = isSelected ? EXIT_SELECTED : EXIT_UNSELECTED;
			rows.push(`${marker} [${checkmark}] ${action.label}`);
		}
		rows.push(EXIT_EMPTY);
		const focused = this.state.focused;
		const isSubmitFocused = focused === EXIT_SUBMIT_KEY;
		const submitMarker = isSubmitFocused ? EXIT_FOCUSED : EXIT_UNFOCUSED;
		const isCancelFocused = focused === EXIT_CANCEL_KEY;
		const cancelMarker = isCancelFocused ? EXIT_FOCUSED : EXIT_UNFOCUSED;
		rows.push(
			`${submitMarker} ${EXIT_SUBMIT_LABEL}    ${cancelMarker} ${EXIT_CANCEL_LABEL}`,
		);
		return rows.map((row) => truncateToWidth(row, width, EXIT_EMPTY));
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
		}
	}

	private toggleFocusedAction(): void {
		const focused = this.state.focused;
		const focusedAction = typeof focused === "object";
		if (!focusedAction) return;
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
				(action) =>
					({
						type: EXIT_ACTION_KEY,
						id: action.id,
					}) as const,
			),
			EXIT_SUBMIT_KEY,
			EXIT_CANCEL_KEY,
		];
		const index = targets.findIndex(this.isSameFocus.bind(this));
		const next = targets[(index + direction + targets.length) % targets.length];
		const hasNext = next !== undefined;
		if (hasNext) this.state = { ...this.state, focused: next };
	}

	private isSameFocus(target: PickerFocus): boolean {
		const targetAction = typeof target === "object" ? target : undefined;
		const focusedAction =
			typeof this.state.focused === "object" ? this.state.focused : undefined;
		const bothAreActions =
			targetAction !== undefined && focusedAction !== undefined;
		if (bothAreActions) return targetAction.id === focusedAction.id;
		return target === this.state.focused;
	}
}

function canPresent(
	context: ExtensionContext | null,
): context is ExtensionContext {
	return Boolean(context?.hasUI);
}

async function pickActions(
	context: ExtensionContext,
	actions: readonly ExitAction[],
): Promise<ExitPickerResult> {
	const custom = context.ui.custom;
	const isTuiMode = context.mode === EXIT_TUI_MODE;
	const hasCustomPicker = typeof custom === "function";
	const canUseCustomPicker = isTuiMode && hasCustomPicker;
	if (canUseCustomPicker) return pickWithCustomUI(custom, actions);
	const selectedIds: string[] = [];
	for (const action of actions) {
		const confirmed = await context.ui.confirm(EXIT_TITLE, action.label);
		if (confirmed) selectedIds.push(action.id);
	}
	return selectedIds;
}

function selectedActions(
	actions: readonly ExitAction[],
	selected: ExitPickerResult,
): readonly ExitAction[] {
	const wasCancelled = selected === null;
	if (wasCancelled) return [];
	const selectedIds = new Set(selected);
	return actions.filter((action) => selectedIds.has(action.id));
}

export async function presentExitActions(
	context: ExtensionContext | null,
	actions: readonly ExitAction[],
	isCurrent?: () => boolean,
): Promise<void> {
	const isCurrentPrompt = isCurrent ?? (() => true);
	const hasContext = canPresent(context);
	const hasActions = actions.length > 0;
	const shouldPresent = hasContext && hasActions;
	if (!shouldPresent) return;
	const selected = await pickActions(context, actions);
	const isCurrentAfterPick = isCurrentPrompt();
	if (!isCurrentAfterPick) return;
	const actionsToExecute = selectedActions(actions, selected);
	for (const action of actionsToExecute) {
		const isCurrentBeforeAction = isCurrentPrompt();
		if (!isCurrentBeforeAction) return;
		await executeExitAction(context, action);
	}
}
