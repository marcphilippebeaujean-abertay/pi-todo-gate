const STRING_LITERAL_UTF8_E4DE7BA7 = "utf8";
const STRING_LITERAL_IGNORE_1B26249E = "ignore";
const STRING_LITERAL_PIPE_A7A324E0 = "pipe";
const STRING_LITERAL_HERDR_F2F47F83 = "herdr";
const STRING_LITERAL_TAB_11BF495B = "tab";
const STRING_LITERAL_GET_DFE6F172 = "get";
const STRING_LITERAL_GIT_A8816E53 = "git";
const STRING_LITERAL_REV_PARSE_5E2572A8 = "rev-parse";
const STRING_LITERAL_GIT_DIR_1BE3DACE = "--git-dir";
const STRING_LITERAL_GIT_COMMON_DIR_588B0A51 = "--git-common-dir";
const STRING_LITERAL_BRANCH_BEB1234E = "branch";
const STRING_LITERAL_SHOW_CURRENT_42BC7985 = "--show-current";
const STRING_LITERAL_RENAME_4A77A9FD = "rename";
const STRING_LITERAL_PANE_5BC13BCD = "pane";
const STRING_LITERAL_TASK_931D98EE = "task";
const STRING_LITERAL_LIST_91DB04B3 = "list";
const STRING_LITERAL_WORKSPACE_C971E40E = "--workspace";
const STRING_LITERAL_MOVE_1793E1A4 = "move";
const STRING_LITERAL_NEW_TAB_E40223A9 = "--new-tab";
const STRING_LITERAL_LABEL_147780B2 = "--label";
const STRING_LITERAL_FOCUS_472A0F6A = "--focus";
const STRING_LITERAL_INFO_675B5DA0 = "info";
const STRING_LITERAL_HERDR_CLAIM_COMPLETE_AA2CC751 = "Herdr claim complete";
const STRING_LITERAL_SESSION_START_D4DF5C85 = "session_start";
const STRING_LITERAL_HERDR_CLAIM_WORKER_RUNNING_IN_2B39C695 =
	"Herdr claim worker running in background; main session remains unblocked.";
const STRING_LITERAL_BEFORE_AGENT_START_3184F7C8 = "before_agent_start";
const STRING_LITERAL_HERDR_CLAIM_WORKER_COMPLETED_BUT_D9D3AD14 =
	"Herdr claim worker completed but could not validate tab claim.";
const STRING_LITERAL_WARNING_0F4FEF2A = "warning";
const STRING_LITERAL_UNKNOWN_ERROR_63864A26 = "unknown error";
const STRING_LITERAL_SESSION_SHUTDOWN_9C07FFB6 = "session_shutdown";

import { execFileSync } from "node:child_process";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	type ClaimWorkerHandle,
	type ClaimWorkerRequest,
	startClaimWorker,
	type WorkerSpawner,
} from "./herdr-claim-worker.ts";
import { isLinkedWorktreePaths, parseBranchName } from "./shared/project.ts";

export type {
	ClaimWorkerHandle,
	ClaimWorkerRequest,
	WorkerSpawner,
} from "./herdr-claim-worker.ts";

const CLAIM_CUSTOM_TYPE = "herdr-claim-gate";
const HERDR_STATUS_KEY = "pi-todo-gate-herdr";
const HERDR_WORKING_STATUS = "Herdr: ⠋ working |";
const HERDR_INSTRUCTIONS = `# STEP 0 — Setup Herdr (FIRST, NOT SKIPPABLE)

> The very first thing you do in every session — before any other command, before reading any
> file, before answering the user. Skipping this and going straight to answering is a setup
> violation: stop and do it now, every session, no exceptions.

Herdr is the terminal multiplexer these sessions run in; \`HERDR_ENV=1\` means you are inside it.
Panes and tabs are yours to manage; workspaces and worktrees are not.

### The claim procedure — do this literally, in order

1. First bash command of the session, always:
   \`\`\`bash
   echo HERDR_ENV=\\$HERDR_ENV
   \`\`\`
2. If the value is not \`1\`, stop here — you are not inside Herdr.
3. If it is \`1\`, continue before anything else:
   \`\`\`bash
   herdr pane current
   \`\`\`
   Read \`tab_id\` and \`pane_id\` off the JSON response — do not guess.
4. Then:
   \`\`\`bash
   herdr tab get <tab-id-from-step-3>
   \`\`\`
5. Decide from the \`label\` in that response:
   - If the extension did not rename the current tab automatically, compare the current tab label
     with the task in this prompt. A label matches only when it clearly describes this task; a bare
     number or unrelated task does not match.
   - If the label matches your task → stay in this tab; nothing else to do.
   - If the label does not match your task, inspect current tab's panes and \`herdr agent list\` to
     determine whether another pane in the current tab has an agent. If no other pane in the current
     tab has an agent, rename the current tab:
     \`herdr tab rename <tab-id> <short-name>\`.
   - If another pane in the current tab has an agent, do not rename shared tab. Move your pane to a
     new tab and focus it:
     \`herdr pane move <pane-id> --new-tab --label <short-name> --focus\`.
   - Derive <short-name> from the task in the user's initial prompt — short, lowercase, concrete
     (\`wiki-book\`, \`fix-atlas-pack\`), never from the branch, worktree, or repo.
   - Use \`herdr pane list --workspace "$HERDR_WORKSPACE_ID"\` and \`herdr agent list\` for
     inspection; compare pane \`tab_id\` values with current \`tab_id\`, and do not count your own
     pane as another agent.

Do not run any other tool (\`read\`, \`edit\`, \`write\`, \`bash\`, or answering the user) until steps 1–5 are done. The Herdr skill is the CLI reference for pane/tab commands; the old
\`herdr-panes-and-tabs-management\` skill has been removed, so the procedure above is the source of
truth.

### This step runs in an isolated background worker

The integrated extension starts this prompt in an ephemeral worker with Herdr extensions disabled.
Worker output stays private. The main session remains unblocked while this procedure runs.

The worker completes the claim only after it renames or moves its pane. After success, output exactly one JSON object and nothing else:
\`{"status":"claimed","tabId":"<current-tab-id>","label":"<new-tab-label>"}\`.
`;

export type CommandRunner = (command: string, args: string[]) => string;
export type StartBackgroundWorker = (
	request: ClaimWorkerRequest,
) => ClaimWorkerHandle;

export interface ClaimGateOptions {
	commandRunner?: CommandRunner;
	cwd?: string;
	startBackgroundWorker?: StartBackgroundWorker;
	spawnWorker?: WorkerSpawner;
}

function isSubagent(): boolean {
	return process.env.PI_SUBAGENT_CHILD === "1";
}

function isInsideHerdr(): boolean {
	return process.env.HERDR_ENV === "1";
}

function runCommand(command: string, args: string[], cwd: string): string {
	return execFileSync(command, args, {
		cwd,
		encoding: STRING_LITERAL_UTF8_E4DE7BA7,
		stdio: [
			STRING_LITERAL_IGNORE_1B26249E,
			STRING_LITERAL_PIPE_A7A324E0,
			STRING_LITERAL_IGNORE_1B26249E,
		],
	});
}

function jsonResult<T>(output: string): T | undefined {
	try {
		return JSON.parse(output) as T;
	} catch {
		return undefined;
	}
}

function tabLabel(
	commandRunner: CommandRunner,
	tabId = process.env.HERDR_TAB_ID,
): string | undefined {
	if (!tabId) return undefined;
	const response = jsonResult<{ result?: { tab?: { label?: string } } }>(
		commandRunner(STRING_LITERAL_HERDR_F2F47F83, [
			STRING_LITERAL_TAB_11BF495B,
			STRING_LITERAL_GET_DFE6F172,
			tabId,
		]),
	);
	const label = response?.result?.tab?.label?.trim();
	return label || undefined;
}

function isDefaultTabLabel(label: string | undefined): boolean {
	return label !== undefined && /^\d+$/.test(label);
}

function claimWorktreeTab(commandRunner: CommandRunner, cwd: string): boolean {
	try {
		const gitDir = commandRunner(STRING_LITERAL_GIT_A8816E53, [
			STRING_LITERAL_REV_PARSE_5E2572A8,
			STRING_LITERAL_GIT_DIR_1BE3DACE,
		]);
		const commonDir = commandRunner(STRING_LITERAL_GIT_A8816E53, [
			STRING_LITERAL_REV_PARSE_5E2572A8,
			STRING_LITERAL_GIT_COMMON_DIR_588B0A51,
		]);
		if (!isLinkedWorktreePaths(cwd, gitDir, commonDir)) return false;

		const tabId = process.env.HERDR_TAB_ID;
		const branchName = parseBranchName(
			commandRunner(STRING_LITERAL_GIT_A8816E53, [
				STRING_LITERAL_BRANCH_BEB1234E,
				STRING_LITERAL_SHOW_CURRENT_42BC7985,
			]),
		);
		const defaultTabLabel = tabLabel(commandRunner);
		if (!tabId || !branchName || !isDefaultTabLabel(defaultTabLabel))
			return false;

		commandRunner(STRING_LITERAL_HERDR_F2F47F83, [
			STRING_LITERAL_TAB_11BF495B,
			STRING_LITERAL_RENAME_4A77A9FD,
			tabId,
			branchName,
		]);
		return true;
	} catch {
		return false;
	}
}

function labelIsDescriptive(label: string | undefined | null): boolean {
	if (!label) return false;
	const value = label.trim();
	return Boolean(value) && !/^\d+$/.test(value);
}

function paneTabId(
	commandRunner: CommandRunner,
	paneId: string | undefined,
): string | undefined {
	if (!paneId) return undefined;
	const response = jsonResult<{
		result?: { pane?: { tab_id?: unknown } };
	}>(
		commandRunner(STRING_LITERAL_HERDR_F2F47F83, [
			STRING_LITERAL_PANE_5BC13BCD,
			STRING_LITERAL_GET_DFE6F172,
			paneId,
		]),
	);
	const tabId = response?.result?.pane?.tab_id;
	return typeof tabId === "string" && tabId ? tabId : undefined;
}

function promptTabLabel(prompt: string): string {
	const words = prompt.toLowerCase().match(/[a-z0-9]+/g) ?? [];
	return (
		words.slice(0, 4).join("-").slice(0, 32) || STRING_LITERAL_TASK_931D98EE
	);
}

function claimPromptTab(
	commandRunner: CommandRunner,
	tabId: string | undefined,
	paneId: string | undefined,
	prompt: string,
): boolean {
	if (!tabId || !paneId) return false;
	try {
		const workspaceId = tabId.split(":")[0];
		const response = jsonResult<{
			result?: {
				panes?: Array<{ pane_id?: unknown; tab_id?: unknown; agent?: unknown }>;
			};
		}>(
			commandRunner(STRING_LITERAL_HERDR_F2F47F83, [
				STRING_LITERAL_PANE_5BC13BCD,
				STRING_LITERAL_LIST_91DB04B3,
				STRING_LITERAL_WORKSPACE_C971E40E,
				workspaceId,
			]),
		);
		const shared = response?.result?.panes?.some(
			(pane) =>
				pane.pane_id !== paneId &&
				pane.tab_id === tabId &&
				typeof pane.agent === "string" &&
				pane.agent.length > 0,
		);
		const label = promptTabLabel(prompt);
		if (shared) {
			commandRunner(STRING_LITERAL_HERDR_F2F47F83, [
				STRING_LITERAL_PANE_5BC13BCD,
				STRING_LITERAL_MOVE_1793E1A4,
				paneId,
				STRING_LITERAL_NEW_TAB_E40223A9,
				STRING_LITERAL_LABEL_147780B2,
				label,
				STRING_LITERAL_FOCUS_472A0F6A,
			]);
		} else {
			commandRunner(STRING_LITERAL_HERDR_F2F47F83, [
				STRING_LITERAL_TAB_11BF495B,
				STRING_LITERAL_RENAME_4A77A9FD,
				tabId,
				label,
			]);
		}
		return true;
	} catch {
		return false;
	}
}

function hasValidatedTabClaim(
	commandRunner: CommandRunner,
	initialLabel: string | undefined,
	paneId: string | undefined,
	claim?: { tabId: string; label: string },
): boolean {
	if (initialLabel === undefined) return false;
	try {
		const observedTabId = paneTabId(commandRunner, paneId);
		if (!observedTabId) return false;
		const currentLabel = tabLabel(commandRunner, observedTabId);
		if (!labelIsDescriptive(currentLabel) || currentLabel === initialLabel)
			return false;
		return (
			!claim || (claim.tabId === observedTabId && claim.label === currentLabel)
		);
	} catch {
		return false;
	}
}

function notify(
	ctx: Pick<ExtensionContext, "ui">,
	message: string,
	level: "info" | "warning" | "error" = STRING_LITERAL_INFO_675B5DA0,
): void {
	try {
		ctx.ui.notify(message, level);
	} catch {
		// Headless sessions have no user-facing UI.
	}
}

function setHerdrStatus(
	ctx: Pick<ExtensionContext, "ui">,
	text: string | undefined,
): void {
	try {
		ctx.ui.setStatus(HERDR_STATUS_KEY, text);
	} catch {
		// Headless sessions may not expose status UI.
	}
}

function alreadyClaimed(ctx: {
	sessionManager: {
		getEntries: () => Array<{ type?: string; customType?: string }>;
	};
}): boolean {
	try {
		return ctx.sessionManager
			.getEntries()
			.some(
				(entry) =>
					entry?.type === "custom" && entry?.customType === CLAIM_CUSTOM_TYPE,
			);
	} catch {
		return false;
	}
}

export function installHerdrClaimGate(
	pi: ExtensionAPI,
	options: ClaimGateOptions = {},
): void {
	let sessionCwd = options.cwd ?? process.cwd();
	let sessionTabId: string | undefined;
	let sessionPaneId: string | undefined;
	let sessionTabLabel: string | undefined;
	const commandRunner =
		options.commandRunner ??
		((command, args) => runCommand(command, args, sessionCwd));
	const startWorker =
		options.startBackgroundWorker ??
		((request: ClaimWorkerRequest) =>
			startClaimWorker(request, {
				cwd: sessionCwd,
				spawnWorker: options.spawnWorker,
			}));
	let gateActive = false;
	let herdrAvailable = false;
	let worker: ClaimWorkerHandle | undefined;

	const lift = (ctx?: Pick<ExtensionContext, "ui">): void => {
		gateActive = false;
		if (ctx)
			notify(
				ctx,
				STRING_LITERAL_HERDR_CLAIM_COMPLETE_AA2CC751,
				STRING_LITERAL_INFO_675B5DA0,
			);
	};

	const persistClaimed = (ctx?: Pick<ExtensionContext, "ui">): void => {
		try {
			pi.appendEntry(CLAIM_CUSTOM_TYPE, { at: Date.now() });
		} catch {
			// Gate state still lifts in memory when persistence is unavailable.
		}
		lift(ctx);
	};

	pi.on(STRING_LITERAL_SESSION_START_D4DF5C85, async (_event, ctx) => {
		sessionCwd = typeof ctx.cwd === "string" ? ctx.cwd : sessionCwd;
		gateActive = false;
		herdrAvailable = isInsideHerdr() && !isSubagent();
		worker = undefined;
		if (!herdrAvailable || alreadyClaimed(ctx)) return;
		sessionTabId = process.env.HERDR_TAB_ID;
		sessionPaneId = process.env.HERDR_PANE_ID;
		try {
			sessionTabLabel = tabLabel(commandRunner, sessionTabId);
		} catch {
			sessionTabLabel = undefined;
		}

		gateActive = true;
		if (claimWorktreeTab(commandRunner, sessionCwd)) {
			persistClaimed(ctx);
			return;
		}
		notify(
			ctx,
			STRING_LITERAL_HERDR_CLAIM_WORKER_RUNNING_IN_2B39C695,
			STRING_LITERAL_INFO_675B5DA0,
		);
	});

	pi.on(STRING_LITERAL_BEFORE_AGENT_START_3184F7C8, async (event, ctx) => {
		if (!herdrAvailable || !gateActive || worker) return;
		try {
			worker = startWorker({
				prompt: event.prompt ?? "",
				instructions: HERDR_INSTRUCTIONS,
				onClaimComplete: (claim) => {
					worker = undefined;
					setHerdrStatus(ctx, undefined);
					if (
						hasValidatedTabClaim(
							commandRunner,
							sessionTabLabel,
							sessionPaneId,
							claim,
						) ||
						(claimPromptTab(
							commandRunner,
							sessionTabId,
							sessionPaneId,
							event.prompt ?? "",
						) &&
							hasValidatedTabClaim(
								commandRunner,
								sessionTabLabel,
								sessionPaneId,
								undefined,
							))
					) {
						persistClaimed(ctx);
						return;
					}
					notify(
						ctx,
						STRING_LITERAL_HERDR_CLAIM_WORKER_COMPLETED_BUT_D9D3AD14,
						STRING_LITERAL_WARNING_0F4FEF2A,
					);
				},
				onFailure: (message) => {
					worker = undefined;
					setHerdrStatus(ctx, undefined);
					notify(ctx, message, STRING_LITERAL_WARNING_0F4FEF2A);
				},
			});
			setHerdrStatus(ctx, HERDR_WORKING_STATUS);
		} catch (error) {
			worker = undefined;
			setHerdrStatus(ctx, undefined);
			const detail =
				error instanceof Error
					? error.message
					: String(error ?? STRING_LITERAL_UNKNOWN_ERROR_63864A26);
			notify(
				ctx,
				`Herdr claim worker failed to start: ${detail}`,
				STRING_LITERAL_WARNING_0F4FEF2A,
			);
		}
		// Deliberately return no BeforeAgentStartEventResult: worker prompt and output stay private.
		return undefined;
	});

	pi.on(STRING_LITERAL_SESSION_SHUTDOWN_9C07FFB6, async (_event, ctx) => {
		worker?.cancel();
		worker = undefined;
		setHerdrStatus(ctx, undefined);
		sessionTabId = undefined;
		sessionPaneId = undefined;
		sessionTabLabel = undefined;
		gateActive = false;
		herdrAvailable = false;
	});
}
