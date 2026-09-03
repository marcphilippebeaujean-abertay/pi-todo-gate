import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import { EXTENSION_CONSTANTS as C } from "../constants.ts";
import {
	type ExitPickerResult,
	initialPickerState,
	type PickerFocus,
	type PickerState,
	toggleAction,
} from "./picker.ts";
import type { ExitAction } from "./types.ts";

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
			const checkmark = this.state.selectedIds.has(action.id)
				? C.exit.selected
				: C.exit.unselected;
			rows.push(`${marker} [${checkmark}] ${action.label}`);
		}
		rows.push(C.exit.empty);
		const submitMarker =
			this.state.focused === C.exit.submitKey
				? C.exit.focused
				: C.exit.unfocused;
		const cancelMarker =
			this.state.focused === C.exit.cancelKey
				? C.exit.focused
				: C.exit.unfocused;
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
		const submits = this.state.focused === C.exit.submitKey;
		if (submits) {
			this.done([...this.state.selectedIds]);
			return;
		}
		const cancels = this.state.focused === C.exit.cancelKey;
		if (cancels) {
			this.done(null);
			return;
		}
		this.toggleFocusedAction();
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
