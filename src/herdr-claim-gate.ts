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

### This step is enforced by a hook, not just by prose

A global extension (\`~/.pi/agent/extensions/herdr-claim-gate.ts\`, auto-discovered) arms a gate at
\`session_start\` for every non-subagent session inside Herdr (\`HERDR_ENV=1\`). While the gate is up,
the only bash commands allowed are the Herdr claim commands and inspection commands above
(\`echo HERDR_ENV=…\`, \`herdr pane current\`, \`herdr pane list …\`, \`herdr tab get …\`,
\`herdr agent list\`, \`herdr tab rename …\`, \`herdr pane move … --new-tab …\`, and equivalent
\`test\`/\`printf\` env probes). Every other tool call (bash or otherwise) is blocked.

The gate lifts and persists a session marker once the background worker completes a claim, or when
one of these happen in this session:
- you run \`herdr tab rename …\` (claiming a generic tab),
- you run \`herdr pane move … --new-tab …\` (moving out of a shared tab),
- or a \`herdr tab get\` you ran returns a label that is already descriptive (tab already claimed).

Subagent detection matches pi-subagents: the hook and both skills key on \`PI_SUBAGENT_CHILD=1\`.
Dispatched children never arm the gate. There is no other detection path — Herdr's own integration does
not distinguish subagents, so the subagent exemption is keyed on this same \`PI_SUBAGENT_CHILD=1\` marker.

**Dispatched subagents skip all of that.** If \`PI_SUBAGENT_CHILD=1\`, or your prompt says you were
_dispatched by another agent_, run no Herdr command at all: no tab claim, rename, or pane move. The
agent that spawned you owns the tab and pane you are in; moving or renaming either destroys its
claim.
`;

const BLOCK_MESSAGE =
	"You are not following the Herdr instructions. Follow the tab-claim procedure in your Herdr session context before doing other work.";

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
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
	});
}

function jsonResult<T>(output: string): T | undefined {
	try {
		return JSON.parse(output) as T;
	} catch {
		return undefined;
	}
}

function tabLabel(commandRunner: CommandRunner): string | undefined {
	const tabId = process.env.HERDR_TAB_ID;
	if (!tabId) return undefined;
	const response = jsonResult<{ result?: { tab?: { label?: string } } }>(
		commandRunner("herdr", ["tab", "get", tabId]),
	);
	const label = response?.result?.tab?.label?.trim();
	return label || undefined;
}

function isDefaultTabLabel(label: string | undefined): boolean {
	return label !== undefined && /^\d+$/.test(label);
}

function claimWorktreeTab(commandRunner: CommandRunner, cwd: string): boolean {
	try {
		const gitDir = commandRunner("git", ["rev-parse", "--git-dir"]);
		const commonDir = commandRunner("git", ["rev-parse", "--git-common-dir"]);
		if (!isLinkedWorktreePaths(cwd, gitDir, commonDir)) return false;

		const tabId = process.env.HERDR_TAB_ID;
		const branchName = parseBranchName(
			commandRunner("git", ["branch", "--show-current"]),
		);
		const defaultTabLabel = tabLabel(commandRunner);
		if (!tabId || !branchName || !isDefaultTabLabel(defaultTabLabel))
			return false;

		commandRunner("herdr", ["tab", "rename", tabId, branchName]);
		return true;
	} catch {
		return false;
	}
}

const CHAINING_RE = /[;&|<>`\r\n]|\$\(/;
const HERDR_ID = "[A-Za-z0-9_.:-]+";
const SHORT_LABEL = "[A-Za-z0-9_.\\/-]+";
const ALLOWED: RegExp[] = [
	/^echo HERDR_ENV=\$\{?HERDR_ENV\}?$/,
	/^echo HERDR_ENV=['"]?\$\{?HERDR_ENV\}?['"]?$/,
	/^echo ['"]?\$\{?HERDR_ENV\}?['"]?$/,
	/^test "\$\{HERDR_ENV:-\}" = 1$/,
	/^printf '%s\\n' "\$HERDR_WORKSPACE_ID" "\$HERDR_TAB_ID" "\$HERDR_PANE_ID"$/,
	/^herdr pane current$/,
	/^herdr pane list(?: --workspace (?:\$HERDR_WORKSPACE_ID|"\$HERDR_WORKSPACE_ID"|'\$HERDR_WORKSPACE_ID'))?$/,
	new RegExp(`^herdr tab get ${HERDR_ID}$`),
	/^herdr agent list$/,
	new RegExp(`^herdr tab rename ${HERDR_ID} ${SHORT_LABEL}$`),
	new RegExp(
		`^herdr pane move ${HERDR_ID} --new-tab --label ${SHORT_LABEL} --focus$`,
	),
];

function normalize(command: string): string {
	return command.trim().replace(/\s+/g, " ");
}

function allowedCommand(command: string): boolean {
	if (CHAINING_RE.test(command)) return false;
	const normalized = normalize(command);
	return Boolean(
		normalized && ALLOWED.some((pattern) => pattern.test(normalized)),
	);
}

function completesClaim(command: string): boolean {
	const normalized = normalize(command);
	return (
		/^herdr tab rename \S+ \S+/.test(normalized) ||
		/^herdr pane move \S+ --new-tab\b/.test(normalized)
	);
}

function isTabGet(command: string): boolean {
	return /^herdr tab get \S+/.test(normalize(command));
}

function labelIsDescriptive(label: string | undefined | null): boolean {
	if (!label) return false;
	const value = label.trim();
	return Boolean(value) && !/^\d+$/.test(value);
}

function extractLabel(text: string): string | undefined {
	const response = jsonResult<{
		result?: { tab?: { label?: unknown } };
	}>(text);
	const label = response?.result?.tab?.label;
	return typeof label === "string" ? label : undefined;
}

function textOf(value: unknown): string {
	if (typeof value === "string") return value;
	if (!Array.isArray(value)) return "";
	return value
		.map((part) =>
			typeof part === "object" && part !== null && "text" in part
				? String(part.text)
				: "",
		)
		.join("\n");
}

function notify(
	ctx: Pick<ExtensionContext, "ui">,
	message: string,
	level: "info" | "warning" | "error" = "info",
): void {
	try {
		ctx.ui.notify(message, level);
	} catch {
		// Headless sessions have no user-facing UI.
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
		if (ctx) notify(ctx, "Herdr claim complete", "info");
	};

	const persistClaimed = (ctx?: Pick<ExtensionContext, "ui">): void => {
		try {
			pi.appendEntry(CLAIM_CUSTOM_TYPE, { at: Date.now() });
		} catch {
			// Gate state still lifts in memory when persistence is unavailable.
		}
		lift(ctx);
	};

	pi.on("session_start", async (_event, ctx) => {
		sessionCwd = typeof ctx.cwd === "string" ? ctx.cwd : sessionCwd;
		gateActive = false;
		herdrAvailable = isInsideHerdr() && !isSubagent();
		worker = undefined;
		if (!herdrAvailable || alreadyClaimed(ctx)) return;

		gateActive = true;
		if (claimWorktreeTab(commandRunner, sessionCwd)) {
			persistClaimed(ctx);
			return;
		}
		notify(
			ctx,
			"Herdr claim gate active; background worker will claim this tab before work continues.",
			"warning",
		);
	});

	pi.on("before_agent_start", async (event, ctx) => {
		if (!herdrAvailable || !gateActive || worker) return;
		try {
			worker = startWorker({
				prompt: event.prompt ?? "",
				instructions: HERDR_INSTRUCTIONS,
				onClaimComplete: () => {
					worker = undefined;
					persistClaimed(ctx);
				},
				onFailure: (message) => {
					worker = undefined;
					notify(ctx, message, "warning");
				},
			});
		} catch (error) {
			worker = undefined;
			const detail =
				error instanceof Error
					? error.message
					: String(error ?? "unknown error");
			notify(ctx, `Herdr claim worker failed to start: ${detail}`, "warning");
		}
		// Deliberately return no BeforeAgentStartEventResult: worker prompt and output stay private.
		return undefined;
	});

	pi.on("tool_call", async (event) => {
		if (!gateActive) return;
		if (event.toolName !== "bash") {
			return { block: true, reason: BLOCK_MESSAGE };
		}
		const command =
			(event.input as { command?: string } | undefined)?.command ?? "";
		if (allowedCommand(command)) return undefined;
		return { block: true, reason: BLOCK_MESSAGE };
	});

	pi.on("tool_result", async (event) => {
		if (!gateActive || event.toolName !== "bash" || event.isError) return;
		const command =
			(event.input as { command?: string } | undefined)?.command ?? "";
		if (completesClaim(command)) {
			persistClaimed();
			return;
		}
		if (!isTabGet(command)) return;
		const content = textOf(event.content);
		if (labelIsDescriptive(extractLabel(content))) persistClaimed();
	});

	pi.on("session_shutdown", async () => {
		worker?.cancel();
		worker = undefined;
		gateActive = false;
		herdrAvailable = false;
	});
}
