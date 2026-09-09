import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import { EXTENSION_CONSTANTS as C } from "../constants.ts";
import type { ExitAction } from "./data.ts";
import {
	type ExitPickerResult,
	initialPickerState,
	type PickerFocus,
	type PickerState,
	toggleAction,
} from "./data.ts";
import { executeExitAction } from "./notifications.ts";

type CustomUI = NonNullable<ExtensionContext["ui"]["custom"]>;
type CustomFactory = Parameters<CustomUI>[0];
type PickerTUI = Parameters<CustomFactory>[0];

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
		const rows: string[] = [C.exit.title, C.exit.empty];
		for (const action of this.actions) {
			const isFocused =
				typeof this.state.focused === "object" &&
				this.state.focused.id === action.id;
			const marker = isFocused ? C.exit.focused : C.exit.unfocused;
			const isSelected = this.state.selectedIds.has(action.id);
			const checkmark = isSelected ? C.exit.selected : C.exit.unselected;
			rows.push(`${marker} [${checkmark}] ${action.label}`);
		}
		rows.push(C.exit.empty);
		const focused = this.state.focused;
		const isSubmitFocused = focused === C.exit.submitKey;
		const submitMarker = isSubmitFocused ? C.exit.focused : C.exit.unfocused;
		const isCancelFocused = focused === C.exit.cancelKey;
		const cancelMarker = isCancelFocused ? C.exit.focused : C.exit.unfocused;
		rows.push(
			`${submitMarker} ${C.exit.submit}    ${cancelMarker} ${C.exit.cancel}`,
		);
		return rows.map((row) => truncateToWidth(row, width, C.exit.empty));
	}

	handleInput(data: string): void {
		const movesForward =
			matchesKey(data, Key.tab) || matchesKey(data, Key.down);
		if (movesForward) {
			this.moveFocus(1);
			return;
		}
		const movesBackward =
			matchesKey(data, Key.shift(C.exit.tabKey)) || matchesKey(data, Key.up);
		if (movesBackward) {
			this.moveFocus(-1);
			return;
		}
		const togglesAction = matchesKey(data, Key.space);
		if (togglesAction) {
			this.toggleFocusedAction();
			return;
		}
		const submitsTarget = matchesKey(data, Key.enter);
		if (submitsTarget) {
			this.submitFocusedTarget();
			return;
		}
		const cancelsPicker = matchesKey(data, Key.escape);
		if (cancelsPicker) this.done(null);
	}

	private toggleFocusedAction(): void {
		const focused = this.state.focused;
		const focusedAction = typeof focused === "object";
		if (!focusedAction) return;
		this.state = toggleAction(this.state, focused.id);
	}

	private submitFocusedTarget(): void {
		switch (this.state.focused) {
			case C.exit.submitKey:
				this.done([...this.state.selectedIds]);
				return;
			case C.exit.cancelKey:
				this.done(null);
				return;
			default:
				this.toggleFocusedAction();
		}
	}

	private moveFocus(direction: 1 | -1): void {
		const targets: PickerFocus[] = [
			...this.actions.map((action) => ({
				type: C.exit.actionKey,
				id: action.id,
			})),
			C.exit.submitKey,
			C.exit.cancelKey,
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
	const isTuiMode = context.mode === C.value.tui;
	const hasCustomPicker = typeof custom === "function";
	const canUseCustomPicker = isTuiMode && hasCustomPicker;
	if (canUseCustomPicker) return pickWithCustomUI(custom, actions);
	const selectedIds: string[] = [];
	for (const action of actions) {
		const confirmed = await context.ui.confirm(C.exit.title, action.label);
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
): Promise<void> {
	const hasContext = canPresent(context);
	const hasActions = actions.length > 0;
	const shouldPresent = hasContext && hasActions;
	if (!shouldPresent) return;
	const selected = await pickActions(context, actions);
	const actionsToExecute = selectedActions(actions, selected);
	for (const action of actionsToExecute)
		await executeExitAction(context, action);
}
