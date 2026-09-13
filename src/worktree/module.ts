import "./commands.ts";
import "./git.ts";
import "./constants.ts";
import "./state.ts";
import "./events.ts";
import "./event-consumers.ts";
import "./event-publishers.ts";
import "./notifications.ts";
import "./user-prompts.ts";
import { createWorktreeConsumer } from "./event-consumers.ts";
import type { WorktreeModule, WorktreeModuleOptions } from "./state.ts";

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
	options: WorktreeModuleOptions,
): WorktreeModule {
	return createWorktreeConsumer(options);
}

export {
	cleanupWorktree,
	commandFailure,
	commandOutput,
	currentWorktreeState,
	isCurrentWorktree,
} from "./git.ts";
