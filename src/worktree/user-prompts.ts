import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CONFIRM_PREFIX, CONFIRM_SUFFIX, CONFIRM_TITLE } from "./constants.ts";
import type { WorktreeBaseline } from "./state.ts";

export async function confirmDirtyRemoval(
	context: ExtensionContext,
	worktree: WorktreeBaseline,
): Promise<boolean> {
	return context.ui.confirm(
		CONFIRM_TITLE,
		`${CONFIRM_PREFIX}${worktree.worktreePath}${CONFIRM_SUFFIX}`,
	);
}
