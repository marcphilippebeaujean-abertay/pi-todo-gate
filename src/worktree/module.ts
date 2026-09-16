import "./commands.ts";
import "./git.ts";
import "./constants.ts";
import "./internal-state.ts";
import "./events.ts";
import "./event-consumers.ts";
import "./event-publishers.ts";
import "./notifications.ts";
import { createWorktreeConsumer } from "./event-consumers.ts";
import type { WorktreeModuleOptions } from "./internal-state.ts";

export * from "./module-state.ts";
export interface WorktreeInfo {
	worktreePath: string;
	branch: string;
}

export interface WorktreeCleanup {
	getWorktreeInfo(): WorktreeInfo | null;
	hasUncommittedChanges(): Promise<boolean | null>;
	removeWorktree(options: {
		force: boolean;
	}): Promise<import("../shared/exit-actions.ts").ExitActionResult>;
}

export function createWorktreeModule(
	options: WorktreeModuleOptions,
): WorktreeCleanup {
	return createWorktreeConsumer(options);
}
