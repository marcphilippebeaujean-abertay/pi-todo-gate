import { CLAIM_WORKER_RESPONSE_TEMPLATE } from "./state.ts";

export const MAX_DIAGNOSTIC_BYTES = 500;
export const HERDR_MAX_CLAIM_ATTEMPTS = 3;
export const HERDR_CLAIM_RETURNED = "true";
export const HERDR_OBJECT_TYPE = "object";
export const HERDR_COMMAND = "herdr";
export const PI_COMMAND = "pi";
export const HIGH_THINKING = "high";
export const MISSING_CLAIM_EVIDENCE = "completed without claim evidence";
export const EXPECTED_RESULT_FAILURE = "completed without expected result";
export const HERDR_CLAIM_FAILURE_PREFIX = "Herdr claim ";
export const STDIO_IGNORE = "ignore";
export const STDIO_PIPE = "pipe";
export const DATA_EVENT = "data";
export const ERROR_EVENT = "error";
export const CLOSE_EVENT = "close";
export const UNKNOWN_ERROR = "unknown error";
export const SIGTERM = "SIGTERM";
export const UTF8_ENCODING = "utf8";
export const TAB_GET_COMMAND = ["tab", "get"] as const;
export const TAB_GET_ARGS = ["tab", "get"] as const;
export const TAB_RENAME_ARGS = ["tab", "rename"] as const;
export const PANE_GET_ARGS = ["pane", "get"] as const;
export const PANE_MOVE_ARGS = ["pane", "move"] as const;
export const NEW_TAB_FLAG = "--new-tab";
export const LABEL_FLAG = "--label";
export const NO_FOCUS_FLAG = "--no-focus";
export const STRING_TYPE = "string";
export const NUMERIC_LABEL = /^\d+$/;
export const HERDR_ENVIRONMENT = "HERDR_ENV";
export const HERDR_FOOTER_TYPE = "pi-todo-gate-herdr";
export const HERDR_WORKING_STATUS = "Herdr: ⠋ working |";
export const SESSION_START_EVENT = "session_start";
export const BEFORE_AGENT_START_EVENT = "before_agent_start";
export const SESSION_SHUTDOWN_EVENT = "session_shutdown";
export const CLAIM_COMPLETED_EVENT = "claimCompleted";
export const CLAIM_FAILED_EVENT = "claimFailed";
export const HERDR = "Herdr";
export const TAB_CLAIM_FAILED = "completed without claim evidence";
export const TAB_CLAIM_ACTION_FAILED = "action failed";
export const TAB_CLAIM_START_FAILED = "failed to start";
export const TAB_CLAIM_INSTRUCTIONS = `Inspect current Herdr tab and panes for task in parent prompt.
Use bash. Run \`herdr pane current\`, \`herdr tab get <tab-id>\`, and \`herdr agent list\` as needed.
If current label clearly describes task, return null. Otherwise derive short lowercase concrete label
from task prompt and return \`${JSON.stringify(CLAIM_WORKER_RESPONSE_TEMPLATE)}\` or null when no changes
are needed, setting shouldMoveToNewTab to true when another agent shares current tab and current pane
should move.
Review requests for the current branch or worktree stay in the current tab when the tab relates to the feature under review.
Keep reviewer and implementer side by side; another agent sharing a related tab alone does not warrant a new tab.
Do not rename or move any Herdr tab or pane. Output only JSON. Exit nonzero if inspection cannot complete.`;
