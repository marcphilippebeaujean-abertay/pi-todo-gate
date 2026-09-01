import { EXTENSION_CONSTANTS as C } from "../constants.ts";

export type PickerFocus =
	| typeof C.exit.submitKey
	| typeof C.exit.cancelKey
	| { type: typeof C.exit.actionKey; id: string };

export interface PickerState {
	readonly actionIds: readonly string[];
	readonly selectedIds: ReadonlySet<string>;
	readonly focused: PickerFocus;
}

export type ExitPickerResult = readonly string[] | null;

export function initialPickerState(actionIds: readonly string[]): PickerState {
	return {
		actionIds: [...actionIds],
		selectedIds: new Set(actionIds),
		focused: C.exit.submitKey,
	};
}

export function toggleAction(state: PickerState, id: string): PickerState {
	const isAction = state.actionIds.includes(id);
	if (!isAction) return state;
	const selectedIds = new Set(state.selectedIds);
	const isSelected = selectedIds.has(id);
	if (isSelected) selectedIds.delete(id);
	else selectedIds.add(id);
	return { ...state, selectedIds };
}

export function focusAction(state: PickerState, id: string): PickerState {
	const isAction = state.actionIds.includes(id);
	if (!isAction) return state;
	return { ...state, focused: { type: C.exit.actionKey, id } };
}

export function focusSubmit(state: PickerState): PickerState {
	return { ...state, focused: C.exit.submitKey };
}
