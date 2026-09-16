import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	DIRTY_CONFIRM_PREFIX,
	DIRTY_CONFIRM_SUFFIX,
	DIRTY_CONFIRM_TITLE,
	DIRTY_INFO_SUFFIX,
	MERGE_CONFIRM_MESSAGE,
	MERGE_CONFIRM_TITLE_PREFIX,
	PROMPT_NO,
	PROMPT_YES,
	REMOVE_WORKTREE_CONFIRM_TITLE,
	TODOIST_CONFIRM_MESSAGE_PREFIX,
	TODOIST_CONFIRM_PREFIX,
	TODOIST_CONFIRM_SUFFIX,
} from "./constants.ts";
import type { TodoistCompletionSnapshot } from "./internal-state.ts";

export function confirmMerge(
	context: ExtensionContext,
	prUrl: string,
): Promise<boolean> {
	return context.ui.confirm(
		`${MERGE_CONFIRM_TITLE_PREFIX}${prUrl}?`,
		MERGE_CONFIRM_MESSAGE,
	);
}

export function confirmTodoistCompletion(
	context: ExtensionContext,
	snapshot: TodoistCompletionSnapshot,
): Promise<boolean> {
	return context.ui.confirm(
		`${TODOIST_CONFIRM_PREFIX}${snapshot.taskName}${TODOIST_CONFIRM_SUFFIX}`,
		`${TODOIST_CONFIRM_MESSAGE_PREFIX}${snapshot.taskRef}`,
	);
}

export function confirmDirtyWorktree(
	context: ExtensionContext,
	worktreePath: string,
): Promise<boolean> {
	context.ui.notify(
		`${DIRTY_CONFIRM_PREFIX}${worktreePath}${DIRTY_INFO_SUFFIX}`,
		"warning",
	);
	return context.ui.confirm(
		DIRTY_CONFIRM_TITLE,
		`${DIRTY_CONFIRM_PREFIX}${worktreePath}${DIRTY_CONFIRM_SUFFIX}`,
	);
}

export async function confirmRemoveWorktree(
	context: ExtensionContext,
	worktreePath: string,
	branch: string,
	hasUncommittedChanges: boolean,
): Promise<boolean> {
	const options = hasUncommittedChanges
		? [PROMPT_NO, PROMPT_YES]
		: [PROMPT_YES, PROMPT_NO];
	const answer = await context.ui.select(
		`${REMOVE_WORKTREE_CONFIRM_TITLE}\nDelete worktree "${worktreePath}" and local branch "${branch}"?`,
		options,
	);
	switch (answer) {
		case PROMPT_YES:
			return true;
		default:
			return false;
	}
}
