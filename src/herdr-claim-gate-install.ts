import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	allowedCommand,
	completesClaim,
	isTabGet,
} from "./herdr-claim-gate-commands.ts";
import {
	alreadyClaimed,
	extractLabel,
	labelIsDescriptive,
	notify,
	persistClaimed,
	textOf,
} from "./herdr-claim-gate-context.ts";
import {
	boundCommandRunner,
	claimWorktreeTab,
	defaultStartWorker,
	isInsideHerdr,
	tabLabel,
} from "./herdr-claim-gate-environment.ts";
import type {
	ClaimGateOptions,
	CommandRunner,
	StartBackgroundWorker,
} from "./herdr-claim-gate-types.ts";
import { hasValidatedTabClaim } from "./herdr-claim-gate-validation.ts";
import type {
	ClaimWorkerHandle,
	ClaimWorkerRequest,
} from "./herdr-claim-worker.ts";

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
\`session_start\` for every session inside Herdr (\`HERDR_ENV=1\`). While the gate is up,
the only bash commands allowed are the Herdr claim commands and inspection commands above
(\`echo HERDR_ENV=…\`, \`herdr pane current\`, \`herdr pane list …\`, \`herdr tab get …\`,
\`herdr agent list\`, \`herdr tab rename …\`, \`herdr pane move … --new-tab …\`, and equivalent
\`test\`/\`printf\` env probes). Every other tool call (bash or otherwise) is blocked.

The gate lifts and persists a session marker once the background worker completes a claim, or when
one of these happen in this session:
- you run \`herdr tab rename …\` (claiming a generic tab),
- you run \`herdr pane move … --new-tab …\` (moving out of a shared tab),
- or a \`herdr tab get\` you ran returns a label that is already descriptive (tab already claimed).

### Worker completion

After successful rename or move, output exactly one JSON object and no explanation:
\`{"status":"claimed","tabId":"<current-tab-id>","label":"<new-tab-label>"}\`.
If claim cannot complete, exit nonzero.
`;

const BLOCK_MESSAGE =
	"You are not following the Herdr instructions. Follow the tab-claim procedure in your Herdr session context before doing other work.";
const SESSION_START_EVENT = "session_start";
const BEFORE_AGENT_START_EVENT = "before_agent_start";
const TOOL_CALL_EVENT = "tool_call";
const TOOL_RESULT_EVENT = "tool_result";
const SESSION_SHUTDOWN_EVENT = "session_shutdown";
const BASH_TOOL = "bash";
const WARNING_LEVEL = "warning";
const CLAIM_GATE_MESSAGE =
	"Herdr claim gate active; background worker will claim this tab before work continues.";
const CLAIM_VALIDATION_FAILED_MESSAGE =
	"Herdr claim worker completed but could not validate tab claim.";
const WORKER_START_FAILURE = "Herdr claim worker failed to start: ";

interface ClaimAttemptState {
	generation: number;
	initialTabLabel: string | undefined;
	sessionPaneId: string | undefined;
}

class HerdrClaimGate {
	private readonly pi: ExtensionAPI;
	private sessionCwd: string;
	private readonly sessionCwdReference = { current: process.cwd() };
	private readonly commandRunner: CommandRunner;
	private readonly startWorker: StartBackgroundWorker;
	private readonly shouldActivate: ClaimGateOptions["shouldActivate"];
	gateActive = false;
	private herdrAvailable = false;
	private worker: ClaimWorkerHandle | undefined;
	private pendingClaimCommand: string | undefined;
	private initialTabLabel: string | undefined;
	private sessionPaneId: string | undefined;
	private sessionGeneration = 0;

	constructor(pi: ExtensionAPI, options: ClaimGateOptions) {
		this.pi = pi;
		this.sessionCwd = options.cwd ?? process.cwd();
		this.sessionCwdReference.current = this.sessionCwd;
		this.commandRunner =
			options.commandRunner ?? boundCommandRunner(this.sessionCwdReference);
		this.startWorker =
			options.startBackgroundWorker ??
			((request) =>
				defaultStartWorker(this.sessionCwd, options.spawnWorker, request));
		this.shouldActivate = options.shouldActivate;
		pi.on(SESSION_START_EVENT, this.sessionStart.bind(this));
		pi.on(BEFORE_AGENT_START_EVENT, this.beforeAgentStart.bind(this));
		pi.on(TOOL_CALL_EVENT, this.toolCall.bind(this));
		pi.on(TOOL_RESULT_EVENT, this.toolResult.bind(this));
		pi.on(SESSION_SHUTDOWN_EVENT, this.sessionShutdown.bind(this));
	}

	private sessionStart(_event: unknown, ctx: ExtensionContext): void {
		this.worker?.cancel();
		this.worker = undefined;
		this.pendingClaimCommand = undefined;
		this.sessionGeneration += 1;
		this.sessionCwd = ctx.cwd;
		this.sessionCwdReference.current = this.sessionCwd;
		this.gateActive = false;
		this.initialTabLabel = undefined;
		this.sessionPaneId = undefined;
		this.herdrAvailable = isInsideHerdr();
		const isNotHerdrSession = !this.herdrAvailable;
		const isDisabled = !(this.shouldActivate?.(ctx) ?? true);
		const hasClaim = alreadyClaimed(ctx);
		const isUnavailableOrDisabled = isNotHerdrSession || isDisabled;
		const shouldSkip = isUnavailableOrDisabled || hasClaim;
		if (shouldSkip) return;
		this.sessionPaneId = process.env.HERDR_PANE_ID;
		try {
			this.initialTabLabel = tabLabel(this.commandRunner);
		} catch {
			this.initialTabLabel = undefined;
		}
		this.gateActive = true;
		const claimedByWorktree = claimWorktreeTab(
			this.commandRunner,
			this.sessionCwd,
		);
		if (claimedByWorktree) {
			persistClaimed(this.pi, this, ctx);
			return;
		}
		notify(ctx, CLAIM_GATE_MESSAGE, WARNING_LEVEL);
	}

	private beforeAgentStart(
		event: { prompt?: string },
		ctx: ExtensionContext,
	): void {
		const isUnavailable = !this.herdrAvailable;
		const isInactive = !this.gateActive;
		const hasWorker = Boolean(this.worker);
		const isSessionUnavailable = isUnavailable || isInactive;
		const shouldSkip = isSessionUnavailable || hasWorker;
		if (shouldSkip) return;
		const attempt = structuredClone<ClaimAttemptState>({
			generation: this.sessionGeneration,
			initialTabLabel: this.initialTabLabel,
			sessionPaneId: this.sessionPaneId,
		});
		try {
			this.worker = this.startWorker({
				prompt: event.prompt ?? "",
				instructions: HERDR_INSTRUCTIONS,
				onClaimComplete: this.completeClaim.bind(this, ctx, attempt),
				onFailure: this.failClaim.bind(this, ctx, attempt.generation),
			});
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			this.failClaim(
				ctx,
				attempt.generation,
				`${WORKER_START_FAILURE}${detail}`,
			);
		}
	}

	private completeClaim(
		ctx: ExtensionContext,
		attempt: ClaimAttemptState,
		claim?: Parameters<ClaimWorkerRequest["onClaimComplete"]>[0],
	): void {
		const isCurrentGeneration = attempt.generation === this.sessionGeneration;
		if (!isCurrentGeneration) return;
		this.worker = undefined;
		const isValidated = hasValidatedTabClaim(
			this.commandRunner,
			attempt.initialTabLabel,
			attempt.sessionPaneId,
			claim,
		);
		if (!isValidated) {
			notify(ctx, CLAIM_VALIDATION_FAILED_MESSAGE, WARNING_LEVEL);
			return;
		}
		persistClaimed(this.pi, this, ctx);
	}

	private failClaim(
		ctx: ExtensionContext,
		generation: number,
		message: string,
	): void {
		const isCurrentGeneration = generation === this.sessionGeneration;
		if (!isCurrentGeneration) return;
		this.worker = undefined;
		notify(ctx, message, WARNING_LEVEL);
	}

	private toolCall(event: {
		toolName: string;
		input?: unknown;
	}): { block: boolean; reason: string } | undefined {
		const isInactive = !this.gateActive;
		if (isInactive) return undefined;
		const isBash = event.toolName === BASH_TOOL;
		if (!isBash) return { block: true, reason: BLOCK_MESSAGE };
		const command =
			(event.input as { command?: string } | undefined)?.command ?? "";
		const isAllowed = allowedCommand(command);
		if (isAllowed) {
			const isClaimComplete = completesClaim(command);
			if (isClaimComplete) this.pendingClaimCommand = command;
			return undefined;
		}
		return { block: true, reason: BLOCK_MESSAGE };
	}

	private toolResult(event: {
		toolName: string;
		input?: unknown;
		content: unknown;
		isError?: boolean;
	}): void {
		const isBashResult = this.gateActive && event.toolName === BASH_TOOL;
		if (!isBashResult) return;
		const command =
			(event.input as { command?: string } | undefined)?.command ?? "";
		const isPendingClaim = this.pendingClaimCommand === command;
		if (isPendingClaim) this.pendingClaimCommand = undefined;
		const isFailedClaim = event.isError === true;
		const isSuccessfulClaim = isPendingClaim && !isFailedClaim;
		if (isSuccessfulClaim) {
			persistClaimed(this.pi, this);
			return;
		}
		const isTabGetCommand = isTabGet(command);
		if (!isTabGetCommand) return;
		const content = textOf(event.content);
		const isDescriptive = labelIsDescriptive(extractLabel(content));
		if (isDescriptive) persistClaimed(this.pi, this);
	}

	private sessionShutdown(): void {
		this.sessionGeneration += 1;
		this.worker?.cancel();
		this.worker = undefined;
		this.pendingClaimCommand = undefined;
		this.initialTabLabel = undefined;
		this.sessionPaneId = undefined;
		this.gateActive = false;
		this.herdrAvailable = false;
	}
}

export function installHerdrClaimGate(
	pi: ExtensionAPI,
	options: ClaimGateOptions = {},
): void {
	new HerdrClaimGate(pi, options);
}
