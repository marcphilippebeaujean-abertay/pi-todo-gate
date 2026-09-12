import { CLAIM_WORKER_RESPONSE_TEMPLATE } from "./state.ts";

export const MAX_DIAGNOSTIC_BYTES = 500;
export const HERDR_MAX_CLAIM_ATTEMPTS = 3;
export const HERDR_OBJECT_TYPE = "object";
export const CLAIMED_STATUS = "claimed";
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
export const PANE_GET_ARGS = ["pane", "get"] as const;
export const STRING_TYPE = "string";
export const NUMERIC_LABEL = /^\d+$/;
export const HERDR_ENVIRONMENT = "HERDR_ENV";
export const HERDR_FOOTER_TYPE = "pi-todo-gate-herdr";
export const HERDR_WORKING_STATUS = "Herdr: ⠋ working |";
export const SESSION_START_EVENT = "session_start";
export const BEFORE_AGENT_START_EVENT = "before_agent_start";
export const SESSION_SHUTDOWN_EVENT = "session_shutdown";
export const HERDR = "Herdr";
export const TAB_CLAIM_FAILED = "completed without claim evidence";
export const TAB_CLAIM_START_FAILED = "failed to start";
export const TAB_CLAIM_INSTRUCTIONS = `Rename current Herdr tab for task in parent prompt.
Use bash. First run \`herdr pane current\`, then \`herdr tab get <tab-id>\`.
If current label clearly describes task, leave tab unchanged. Otherwise inspect current tab panes and
\`herdr agent list\`; rename current tab when no other agent shares it, or move current pane to a new
labeled tab when another agent shares it. Derive short lowercase concrete label from task prompt.
After success or valid unchanged label, output only JSON:
\`${JSON.stringify(CLAIM_WORKER_RESPONSE_TEMPLATE)}\`.
Exit nonzero if claim cannot complete.`;
