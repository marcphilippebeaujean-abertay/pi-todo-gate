import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PromptQueue } from "../prompt-queue.ts";
import type { EventHandler } from "../shared/events.ts";
import type { ExitAction } from "../shared/exit-actions.ts";
import type { ModuleContext } from "../shared/module-context.ts";
import type { SessionState } from "../state.ts";
import type { WorktreeModule } from "../worktree/state.ts";
import {
	EXIT_ACTION_KEY,
	type EXIT_CANCEL_KEY,
	EXIT_SUBMIT_KEY,
} from "./constants.ts";

export interface ExitRequest {
	readonly actions: readonly ExitAction[];
	addAction(action: ExitAction): void;
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

export interface ExitProtocolModuleOptions {
	promptQueue: PromptQueue;
	eventHandler: EventHandler;
	sessionState: SessionState;
	worktree?: WorktreeModule;
}

export type ExitProtocolFactory = (
	events: EventHandler,
	promptQueue?: PromptQueue,
	moduleContext?: ModuleContext,
	worktree?: WorktreeModule,
) => ExitProtocolModule;

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

export type CustomUI = NonNullable<ExtensionContext["ui"]["custom"]>;
export type CustomFactory = Parameters<CustomUI>[0];
export type PickerTUI = Parameters<CustomFactory>[0];

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
