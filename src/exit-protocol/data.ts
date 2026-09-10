import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { SharedEvents } from "../shared/events.ts";
import type { PromptQueue } from "../shared/prompt-queue.ts";
import {
	EXIT_ACTION_KEY,
	type EXIT_CANCEL_KEY,
	EXIT_SUBMIT_KEY,
} from "./constants.ts";

export type PickerFocus =
	| typeof EXIT_SUBMIT_KEY
	| typeof EXIT_CANCEL_KEY
	| { type: typeof EXIT_ACTION_KEY; id: string };

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
		focused: EXIT_SUBMIT_KEY,
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
	return { ...state, focused: { type: EXIT_ACTION_KEY, id } };
}

export function focusSubmit(state: PickerState): PickerState {
	return { ...state, focused: EXIT_SUBMIT_KEY };
}

export type {
	ExitAction,
	ExitActionId,
	ExitActionResult,
} from "../shared/exit-actions.ts";
export interface ExitProtocolModule {
	sessionStart(ctx: ExtensionContext): void;
	deactivate(): void;
}
export type ExitProtocolFactory = (
	events: SharedEvents,
	promptQueue: PromptQueue,
) => ExitProtocolModule;
