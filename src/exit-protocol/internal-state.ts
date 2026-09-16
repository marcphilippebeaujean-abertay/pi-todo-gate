import type { PromptQueue } from "../prompt-queue.ts";
import type { EventHandler } from "../shared/events.ts";
import type { ExitAction } from "../shared/exit-actions.ts";
import type { SessionState } from "../state.ts";
import type { WorktreeCleanup } from "../worktree/module.ts";

export interface ExitRequest {
	readonly actions: readonly ExitAction[];
	addAction(action: ExitAction): void;
}

export type {
	ExitAction,
	ExitActionId,
	ExitActionResult,
} from "../shared/exit-actions.ts";

export interface ExitProtocolModuleOptions {
	promptQueue: PromptQueue;
	eventHandler: EventHandler;
	sessionState: SessionState;
	worktree?: WorktreeCleanup;
}

export type ExitSelection = readonly string[] | null;
