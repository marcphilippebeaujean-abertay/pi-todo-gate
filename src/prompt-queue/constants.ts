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
export const EXIT_ACTION_KEY = "action";
export const EXIT_CANCEL_KEY = "cancel";
export const EXIT_SUBMIT_KEY = "submit";
export const EXIT_TITLE = "Exit protocol";
export const EXIT_TAB_KEY = "tab";
export const EXIT_SUBMIT_LABEL = "Submit";
export const EXIT_CANCEL_LABEL = "Cancel";
export const EXIT_TUI_MODE = "tui";
export const EXIT_ACTION_FAILED = "Exit action failed: ";
export const FAILED_ACTION_RESULT = "failed" as const;
export const REMOVE_WORKTREE_ACTION_ID = "remove-worktree" as const;
export const REMOVE_WORKTREE_LABEL_PREFIX = 'Delete worktree "';
export const REMOVE_WORKTREE_LABEL_MIDDLE = '" and local branch "';
export const DIRTY_CONFIRM_TITLE = "Remove worktree with uncommitted changes?";
export const DIRTY_CONFIRM_PREFIX = "Worktree ";
export const DIRTY_CONFIRM_SUFFIX =
	" has uncommitted changes. Force removal will delete them.";
