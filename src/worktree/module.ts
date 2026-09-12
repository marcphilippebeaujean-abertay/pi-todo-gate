import "./commands.ts";
import "./git.ts";
import "./constants.ts";
import "./state.ts";
import "./events.ts";
import "./event-consumers.ts";
import "./event-publishers.ts";
import "./notifications.ts";
import "./user-prompts.ts";
import type { SharedEvents } from "../shared/events.ts";
import type { ModuleContext } from "../shared/module-context.ts";
import { createWorktreeConsumer } from "./event-consumers.ts";
import type { WorktreeModule, WorktreeModuleDependencies } from "./state.ts";

export * from "./events.ts";
export type {
	MergeRequest,
	WorktreeBaseline,
	WorktreeCurrentState,
	WorktreeModule,
	WorktreeModuleDependencies,
} from "./state.ts";

export function createWorktreeModule(
	events: SharedEvents,
	dependencies?: WorktreeModuleDependencies,
	moduleContext?: ModuleContext,
): WorktreeModule {
	return createWorktreeConsumer(events, dependencies ?? {}, moduleContext);
}

export {
	cleanupWorktree,
	commandFailure,
	commandOutput,
	currentWorktreeState,
	isCurrentWorktree,
} from "./git.ts";
