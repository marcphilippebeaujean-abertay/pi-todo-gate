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
import { createSessionState } from "../state.ts";
import type { WorktreeModule } from "../worktree/state.ts";
import { ExitProtocolConsumer } from "./event-consumers.ts";
import type { ExitProtocolModule, ExitProtocolModuleOptions } from "./state.ts";

export type {
	ExitAction,
	ExitActionId,
	ExitActionResult,
} from "../shared/exit-actions.ts";
export * from "./events.ts";
export * from "./state.ts";
export * from "./user-prompts.ts";

export function createExitProtocolModule(
	options: ExitProtocolModuleOptions,
): ExitProtocolModule;
export function createExitProtocolModule(
	events: EventHandler,
	promptQueue?: PromptQueue,
	moduleContext?: ModuleContext,
	worktree?: WorktreeModule,
): ExitProtocolModule;
export function createExitProtocolModule(
	optionsOrEvents: ExitProtocolModuleOptions | EventHandler,
	promptQueue?: PromptQueue,
	moduleContext?: ModuleContext,
	worktree?: WorktreeModule,
): ExitProtocolModule {
	if ("eventHandler" in optionsOrEvents) {
		return new ExitProtocolConsumer(optionsOrEvents);
	}
	const context = moduleContext ?? {
		promptQueue: promptQueue ?? new PromptQueue(),
		eventHandler: optionsOrEvents,
		sessionState: createSessionState(),
	};
	return new ExitProtocolConsumer({
		promptQueue: context.promptQueue,
		eventHandler: context.eventHandler,
		sessionState: context.sessionState,
		worktree,
	});
}
