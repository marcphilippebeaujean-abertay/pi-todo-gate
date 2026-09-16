import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	CONFIRM_PREFIX,
	CONFIRM_SUFFIX,
	CONFIRM_TITLE,
	DIRTY_INFO_SUFFIX,
} from "./constants.ts";
import type { WorktreeBaseline } from "./internal-state.ts";
import { notifyWorktree } from "./notifications.ts";

export async function confirmDirtyRemoval(
	context: ExtensionContext,
	worktree: WorktreeBaseline,
): Promise<boolean> {
	notifyWorktree(
		context,
		`${CONFIRM_PREFIX}${worktree.worktreePath}${DIRTY_INFO_SUFFIX}`,
		"info",
	);
	return context.ui.confirm(
		CONFIRM_TITLE,
		`${CONFIRM_PREFIX}${worktree.worktreePath}${CONFIRM_SUFFIX}`,
	);
}
