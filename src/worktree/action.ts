import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { EXTENSION_CONSTANTS as C } from "../constants.ts";
import type { ExitAction, ExitActionResult } from "../exit-protocol/types.ts";
import type { WorktreeBaseline } from "./module.ts";

export async function confirmDirtyRemoval(
	context: ExtensionContext,
	worktree: WorktreeBaseline,
): Promise<boolean> {
	return context.ui.confirm(
		C.worktree.confirmTitle,
		`${C.worktree.confirmPrefix}${worktree.worktreePath}${C.worktree.confirmSuffix}`,
	);
}

export function createCleanupAction(
	worktree: WorktreeBaseline,
	execute: () => Promise<ExitActionResult>,
): ExitAction {
	return {
		id: C.worktree.cleanupId,
		label: `Delete worktree "${worktree.worktreePath}" and local branch "${worktree.branch}"`,
		execute,
	};
}
