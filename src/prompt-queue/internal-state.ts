import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { PrModule } from "../pr/module.ts";
import type { EventHandler } from "../shared/events.ts";
import type { ExitAction, ExitActionResult } from "../shared/exit-actions.ts";
import type { SessionState } from "../state.ts";
import type {
	TodoistCompletionSnapshot,
	TodoistModule,
} from "../todoist/module.ts";
import type { WorktreeCleanup } from "../worktree/module.ts";
import {
	EXIT_ACTION_KEY,
	type EXIT_CANCEL_KEY,
	EXIT_SUBMIT_KEY,
} from "./constants.ts";
import type { PromptQueue } from "./queue.ts";

export type PromptTask<T> = (isCurrent: () => boolean) => Promise<T> | T;

export interface CommandDependencies {
	pi?: ExtensionAPI;
	eventHandler: EventHandler;
	sessionState: SessionState;
	pr: PrModule;
	queue: PromptQueue;
	getContext: () => ExtensionContext | null;
	isCurrent: (context: ExtensionContext) => boolean;
}

export interface PromptQueueModuleOptions {
	pi?: ExtensionAPI;
	eventHandler: EventHandler;
	sessionState: SessionState;
	pr: PrModule;
	todoist: TodoistModule;
	worktree: WorktreeCleanup;
	queue?: PromptQueue;
}

export interface PromptQueueModule {
	drain(): Promise<void>;
}

export interface PromptContext {
	context: ExtensionContext;
	sessionId: string;
	isCurrent: () => boolean;
}

export interface ExitRequest {
	readonly actions: readonly ExitAction[];
}

export type { ExitAction, ExitActionResult, TodoistCompletionSnapshot };

export type CustomUI = NonNullable<ExtensionContext["ui"]["custom"]>;
export type CustomFactory = Parameters<CustomUI>[0];
export type PickerTUI = Parameters<CustomFactory>[0];

export type PickerFocus =
	| typeof EXIT_SUBMIT_KEY
	| typeof EXIT_CANCEL_KEY
	| { type: typeof EXIT_ACTION_KEY; id: string };

export interface PickerState {
	readonly actionIds: readonly string[];
	readonly selectedIds: ReadonlySet<string>;
	readonly focused: PickerFocus;
}

export function initialPickerState(actionIds: readonly string[]): PickerState {
	return {
		actionIds: [...actionIds],
		selectedIds: new Set(actionIds),
		focused: EXIT_SUBMIT_KEY,
	};
}

export function toggleAction(state: PickerState, id: string): PickerState {
	const hasAction = state.actionIds.includes(id);
	if (!hasAction) return state;
	const selectedIds = new Set(state.selectedIds);
	const isSelected = selectedIds.has(id);
	if (isSelected) selectedIds.delete(id);
	else selectedIds.add(id);
	return { ...state, selectedIds };
}

export function focusAction(state: PickerState, id: string): PickerState {
	const hasAction = state.actionIds.includes(id);
	if (!hasAction) return state;
	return { ...state, focused: { type: EXIT_ACTION_KEY, id } };
}

export function focusSubmit(state: PickerState): PickerState {
	return { ...state, focused: EXIT_SUBMIT_KEY };
}
