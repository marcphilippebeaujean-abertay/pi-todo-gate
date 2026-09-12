import "./commands.ts";
import "./constants.ts";
import "./state.ts";
import "./events.ts";
import "./event-consumers.ts";
import "./event-publishers.ts";
import "./notifications.ts";
import "./user-prompts.ts";
import { PromptQueue } from "../prompt-queue.ts";
import type { EventHandler } from "../shared/events.ts";
import type { ModuleContext } from "../shared/module-context.ts";
import type { WorktreeModule } from "../worktree/state.ts";
import { ExitProtocolConsumer } from "./event-consumers.ts";
import type { ExitProtocolModule } from "./state.ts";

export type {
	ExitAction,
	ExitActionId,
	ExitActionResult,
} from "../shared/exit-actions.ts";
export * from "./events.ts";
export * from "./state.ts";
export * from "./user-prompts.ts";

export function createExitProtocolModule(
	events: EventHandler,
	promptQueue?: PromptQueue,
	moduleContext?: ModuleContext,
	worktree?: WorktreeModule,
): ExitProtocolModule {
	const queue = promptQueue ?? new PromptQueue();
	return new ExitProtocolConsumer(events, queue, moduleContext, worktree);
}
