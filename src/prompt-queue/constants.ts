import { fileURLToPath } from "node:url";

export const mergeProtocolSkillPath = fileURLToPath(
	new URL("../../skills/merge-protocol", import.meta.url),
);
export const MERGE_COMMAND = "merge";
export const MERGE_DESCRIPTION =
	"Merge the active session's pinned pull request";
export const MERGE_CONFIRM_TITLE_PREFIX = "Merge PR ";
export const MERGE_CONFIRM_MESSAGE = "Confirm merge of pinned pull request.";
export const NO_PR_MESSAGE = "No pinned pull request is available to merge";
export const INACTIVE_MESSAGE = "Merge protocol is inactive for this project";
export const NO_UI_MESSAGE = "Merge protocol requires an interactive UI";
export const TODOIST_CONFIRM_PREFIX = 'Mark Todoist task "';
export const TODOIST_CONFIRM_SUFFIX = '" complete?';
export const TODOIST_CONFIRM_MESSAGE_PREFIX = "Todoist task ";
export const REMOVE_WORKTREE_CONFIRM_TITLE = "Remove worktree?";
export const DIRTY_CONFIRM_TITLE = "Remove worktree with uncommitted changes?";
export const PROMPT_YES = "Yes";
export const PROMPT_NO = "No";
export const DIRTY_CONFIRM_PREFIX = "Worktree ";
export const DIRTY_CONFIRM_SUFFIX =
	" has uncommitted changes. Force removal will delete them.";
export const DIRTY_INFO_SUFFIX =
	" has uncommitted work. Deleting it will permanently remove that work.";
