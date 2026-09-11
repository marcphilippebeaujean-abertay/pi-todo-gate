import "./commands.ts";
import "./constants.ts";
import "./state.ts";
import "./event-consumers.ts";
import "./event-publishers.ts";
import "./notifications.ts";
import "./user-prompts.ts";
import type { SharedEvents } from "../shared/events.ts";
import { createWorktreeConsumer } from "./event-consumers.ts";
import type { WorktreeModule, WorktreeModuleDependencies } from "./state.ts";

export type {
	WorktreeBaseline,
	WorktreeCurrentState,
	WorktreeModule,
	WorktreeModuleDependencies,
} from "./state.ts";

export function createWorktreeModule(
	events: SharedEvents,
	dependencies?: WorktreeModuleDependencies,
): WorktreeModule {
	return createWorktreeConsumer(events, dependencies ?? {});
}

export { isCurrentWorktree } from "./commands.ts";
