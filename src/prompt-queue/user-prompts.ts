import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { EXTENSION_CONSTANTS as C } from "../shared/constants.ts";
import {
	DIRTY_CONFIRM_PREFIX,
	DIRTY_INFO_SUFFIX,
	EXIT_PROTOCOL_TITLE,
	MERGE_CONFIRM_MESSAGE,
	MERGE_CONFIRM_TITLE_PREFIX,
	MERGE_DIRTY_INFO_SUFFIX,
	MERGE_DIRTY_WARNING,
	PROMPT_NO,
	PROMPT_YES,
} from "./constants.ts";
import type { ExitProtocolPrompt, MergePrompt } from "./internal-state.ts";

export async function confirmMerge(
	context: ExtensionContext,
	prUrl: string,
	prompt: MergePrompt,
): Promise<boolean> {
	const hasUncommittedChanges = prompt.hasUncommittedChanges;
	const shouldUseStandardConfirmation = !hasUncommittedChanges;
	if (shouldUseStandardConfirmation)
		return context.ui.confirm(
			`${MERGE_CONFIRM_TITLE_PREFIX}${prUrl}?`,
			MERGE_CONFIRM_MESSAGE,
		);
	const worktreePath = prompt.worktreePath;
	if (worktreePath !== undefined)
		context.ui.notify(
			`${DIRTY_CONFIRM_PREFIX}${worktreePath}${MERGE_DIRTY_INFO_SUFFIX}`,
			C.value.warning,
		);
	const answer = await context.ui.select(
		`${MERGE_CONFIRM_TITLE_PREFIX}${prUrl}?\n${MERGE_DIRTY_WARNING}`,
		[PROMPT_NO, PROMPT_YES],
	);
	return answer === PROMPT_YES;
}

export async function confirmExitProtocol(
	context: ExtensionContext,
	prompt: ExitProtocolPrompt,
): Promise<boolean> {
	const actions: string[] = [];
	const taskName = prompt.taskName;
	const shouldAddTaskAction = taskName !== undefined;
	if (shouldAddTaskAction)
		actions.push(`Mark Todoist task "${taskName}" complete`);
	const worktreePath = prompt.worktreePath;
	const branch = prompt.branch;
	const shouldAddWorktreeAction =
		worktreePath !== undefined && branch !== undefined;
	if (shouldAddWorktreeAction) {
		const verb = shouldAddTaskAction ? "delete" : "Delete";
		actions.push(
			`${verb} worktree "${worktreePath}" and local branch "${branch}"`,
		);
	}
	const hasUncommittedChanges = prompt.hasUncommittedChanges;
	const dirtyWarning = hasUncommittedChanges
		? `\nWorktree has uncommitted changes. Deleting it will permanently remove that work.`
		: "";
	const shouldNotifyDirtyWorktree =
		hasUncommittedChanges && worktreePath !== undefined;
	if (shouldNotifyDirtyWorktree)
		context.ui.notify(
			`${DIRTY_CONFIRM_PREFIX}${worktreePath}${DIRTY_INFO_SUFFIX}`,
			C.value.warning,
		);
	const options = hasUncommittedChanges
		? [PROMPT_NO, PROMPT_YES]
		: [PROMPT_YES, PROMPT_NO];
	const answer = await context.ui.select(
		`${EXIT_PROTOCOL_TITLE}\n${actions.join(" and ")}?${dirtyWarning}`,
		options,
	);
	const confirmed = answer === PROMPT_YES;
	return confirmed;
}
