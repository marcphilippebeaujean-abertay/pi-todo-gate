export const GH_COMMAND = "gh";
export const PR_COMMAND = "pr";
export const JSON_FLAG = "--json";
export const VIEW_COMMAND = "view";
export const MERGE_COMMAND = "merge";
export const UNKNOWN_STATE = "UNKNOWN";
export const MERGED_STATE = "MERGED";
export const OPEN_STATE = "OPEN";
export const CLOSED_STATE = "CLOSED";
export const END_OF_OPTIONS = "--";
export const GIT_COMMAND = "git";
export const GH_KIND = "gh";
export const PR_STATE_TYPE = "pi-pr-gate-state";
export const PR_CANDIDATE = /https?:\/\/github\.com\/[^\s<>"']+/gi;
export const TRAILING_PUNCTUATION = /[.,;:!?)}\]]+$/g;
export const CONFIRM_TITLE_PREFIX = "Merge PR ";
export const CONFIRM_MESSAGE = "Confirm merge of pinned pull request.";
export const NO_PR_MESSAGE = "No pinned pull request is available to merge";
export const INACTIVE_MESSAGE = "Merge protocol is inactive for this project";
export const NO_UI_MESSAGE = "Merge protocol requires an interactive UI";
export const MERGE_FAILED_PREFIX = "Pull request merge failed";
export const MERGE_SUCCEEDED = "Pull request merged";
export const MAX_ERROR_LENGTH = 200;
export const MERGE_PROTOCOL_COMMAND = "merge";
export const MERGE_PR_MODE = "--merge";
export const GIT_MERGE_VALUE_OPTIONS = new Set([
	"-m",
	"--message",
	"-s",
	"--strategy",
	"-X",
	"--strategy-option",
	"--into-name",
]);
export const NON_COMPLETING_GIT_MERGE_OPTIONS = new Set([
	"--no-commit",
	"--squash",
]);
export const NON_COMPLETING_GH_MERGE_OPTIONS = new Set(["--auto", "--dry-run"]);
export const GH_MERGE_FLAG_OPTIONS = new Set([
	"--admin",
	"--auto",
	"--delete-branch",
	"--disable-auto",
	"--dry-run",
	"--merge",
	"--rebase",
	"--squash",
]);
export const GH_MERGE_VALUE_OPTIONS = new Set([
	"--author-email",
	"--body",
	"--body-file",
	"--match-head-commit",
	"--subject",
	"--repo",
	"-R",
]);
