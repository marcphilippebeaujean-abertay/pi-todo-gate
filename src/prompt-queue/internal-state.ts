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
import type { PromptQueue } from "./queue.ts";

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

export type PickerFocus = "submit" | "cancel" | { type: "action"; id: string };

export interface PickerState {
	readonly actionIds: readonly string[];
	readonly selectedIds: ReadonlySet<string>;
	readonly focused: PickerFocus;
}

export function initialPickerState(actionIds: readonly string[]): PickerState {
	return {
		actionIds: [...actionIds],
		selectedIds: new Set(actionIds),
		focused: "submit",
	};
}

export function toggleAction(state: PickerState, id: string): PickerState {
	if (!state.actionIds.includes(id)) return state;
	const selectedIds = new Set(state.selectedIds);
	if (selectedIds.has(id)) selectedIds.delete(id);
	else selectedIds.add(id);
	return { ...state, selectedIds };
}

export function focusAction(state: PickerState, id: string): PickerState {
	if (!state.actionIds.includes(id)) return state;
	return { ...state, focused: { type: "action", id } };
}

export function focusSubmit(state: PickerState): PickerState {
	return { ...state, focused: "submit" };
}
