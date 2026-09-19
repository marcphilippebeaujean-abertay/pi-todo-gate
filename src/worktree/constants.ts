const WORKTREE_TEXT = { empty: "" } as const;
export const EMPTY = WORKTREE_TEXT.empty;
export const GIT = "git";
export const HEAD_ARGS = ["rev-parse", "HEAD"] as const;
export const STATUS_ARGS = [
	"status",
	"--porcelain=v1",
	"--untracked-files=all",
] as const;
export const REMOVE_ARGS = ["worktree", "remove"] as const;
export const FORCE_ARG = "--force";
export const BRANCH_ARGS = ["branch", "-D"] as const;
export const CLEANUP_ID = "remove-worktree";
export const CLEANUP_SUCCESS = "Worktree and local branch deleted";
export const NO_CHANGES = "Worktree deleted because no changes were made";
export const CLEANUP_FAILED = "Worktree cleanup failed: ";
export const REMOVAL_FAILED = "worktree removal failed";
export const BRANCH_FAILED = "branch deletion failed";
export const REMOVED_BRANCH_FAILED =
	"Worktree removed, but local branch deletion failed: ";
export const CLEANUP_SKIPPED_SESSION_CHANGE =
	"Worktree cleanup skipped because session changed";
export const CLEANUP_FINISHED_SESSION_CHANGE =
	"Worktree removal finished after session changed; branch deletion skipped";
export const BRANCH_SKIPPED_SESSION_CHANGE =
	"Worktree removed after session changed; local branch deletion skipped";
export const INFO = "info";
export const WARNING = "warning";
export const COMPLETED = "completed";
export const FAILED = "failed";
export const QUIT = "quit";
