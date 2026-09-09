import type { ExitAction, ExitActionResult } from "../shared/exit-actions.ts";
import type { WorktreeBaseline } from "./data.ts";

export function createCleanupAction(
	worktree: WorktreeBaseline,
	execute: () => Promise<ExitActionResult>,
): ExitAction {
	return {
		id: "remove-worktree",
		label: `Delete worktree "${worktree.worktreePath}" and local branch "${worktree.branch}"`,
		execute,
	};
}
