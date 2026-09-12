import type { ExitAction, ExitActionResult } from "../shared/exit-actions.ts";
import { CLEANUP_ID } from "./constants.ts";
import type { WorktreeBaseline } from "./state.ts";

export function createCleanupAction(
	worktree: WorktreeBaseline,
	execute: () => Promise<ExitActionResult>,
): ExitAction {
	return {
		id: CLEANUP_ID,
		label: `Delete worktree "${worktree.worktreePath}" and local branch "${worktree.branch}"`,
		execute,
	};
}
