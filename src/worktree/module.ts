import "./commands.ts";
import "./git.ts";
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
import { createWorktreeConsumer } from "./event-consumers.ts";
import type {
	WorktreeModule,
	WorktreeModuleDependencies,
	WorktreeModuleOptions,
} from "./state.ts";

export * from "./events.ts";
export type {
	WorktreeBaseline,
	WorktreeCurrentState,
	WorktreeInfo,
	WorktreeModule,
	WorktreeModuleDependencies,
	WorktreeModuleOptions,
} from "./state.ts";

export function createWorktreeModule(
	options: WorktreeModuleOptions,
): WorktreeModule;
export function createWorktreeModule(
	events: EventHandler,
	dependencies?: WorktreeModuleDependencies,
	moduleContext?: ModuleContext,
): WorktreeModule;
export function createWorktreeModule(
	optionsOrEvents: WorktreeModuleOptions | EventHandler,
	dependencies?: WorktreeModuleDependencies,
	moduleContext?: ModuleContext,
): WorktreeModule {
	if ("eventHandler" in optionsOrEvents) {
		return createWorktreeConsumer(optionsOrEvents);
	}
	const moduleDependencies = dependencies ?? {};
	const context = moduleContext ?? {
		promptQueue: new PromptQueue(),
		eventHandler: optionsOrEvents,
		sessionState: createSessionState(),
	};
	return createWorktreeConsumer({
		promptQueue: context.promptQueue,
		eventHandler: context.eventHandler,
		sessionState: context.sessionState,
		dependencies: moduleDependencies,
	});
}

export {
	cleanupWorktree,
	commandFailure,
	commandOutput,
	currentWorktreeState,
	isCurrentWorktree,
} from "./git.ts";
