import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type {
	ClaimWorkerHandle,
	ClaimWorkerRequest,
	WorkerSpawner,
} from "./herdr-claim-worker.ts";
import {
	boundCommandRunner,
	claimWorktreeTab,
	defaultStartWorker,
	isInsideHerdr,
	tabLabel,
} from "./herdr-tab-environment.ts";
import { hasValidatedTabClaim } from "./herdr-tab-validation.ts";
import { isSubagent } from "./session.ts";

const SESSION_START_EVENT = "session_start";
const BEFORE_AGENT_START_EVENT = "before_agent_start";
const SESSION_SHUTDOWN_EVENT = "session_shutdown";
const WARNING_LEVEL = "warning";
const TAB_CLAIM_FAILED = "Herdr background tab naming failed validation.";
const TAB_CLAIM_START_FAILED = "Herdr background tab naming failed to start: ";
const TAB_CLAIM_INSTRUCTIONS = `Rename current Herdr tab for task in parent prompt.
Use bash. First run \`herdr pane current\`, then \`herdr tab get <tab-id>\`.
If current label clearly describes task, leave tab unchanged. Otherwise inspect current tab panes and
\`herdr agent list\`; rename current tab when no other agent shares it, or move current pane to a new
labeled tab when another agent shares it. Derive short lowercase concrete label from task prompt.
After success or valid unchanged label, output only JSON:
\`{"status":"claimed","tabId":"<current-tab-id>","label":"<current-tab-label>"}\`.
Exit nonzero if claim cannot complete.`;

export type CommandRunner = (command: string, args: string[]) => string;
export type StartBackgroundWorker = (
	request: ClaimWorkerRequest,
) => ClaimWorkerHandle;

export interface HerdrTabOptions {
	commandRunner?: CommandRunner;
	cwd?: string;
	startBackgroundWorker?: StartBackgroundWorker;
	spawnWorker?: WorkerSpawner;
	shouldActivate?: (ctx: ExtensionContext) => boolean;
}

interface TabClaimAttempt {
	generation: number;
	initialLabel: string | undefined;
	paneId: string | undefined;
}

class HerdrTabClaim {
	private readonly commandRunner: CommandRunner;
	private readonly startWorker: StartBackgroundWorker;
	private readonly shouldActivate: HerdrTabOptions["shouldActivate"];
	private sessionCwd: string;
	private readonly sessionCwdReference = { current: process.cwd() };
	private worker: ClaimWorkerHandle | undefined;
	private sessionGeneration = 0;
	private herdrAvailable = false;
	private hasClaim = false;
	private initialLabel: string | undefined;
	private paneId: string | undefined;

	constructor(pi: ExtensionAPI, options: HerdrTabOptions) {
		this.commandRunner =
			options.commandRunner ?? boundCommandRunner(this.sessionCwdReference);
		this.sessionCwd = options.cwd ?? process.cwd();
		this.sessionCwdReference.current = this.sessionCwd;
		this.startWorker =
			options.startBackgroundWorker ??
			((request) =>
				defaultStartWorker(this.sessionCwd, options.spawnWorker, request));
		this.shouldActivate = options.shouldActivate;
		pi.on(SESSION_START_EVENT, this.sessionStart.bind(this));
		pi.on(BEFORE_AGENT_START_EVENT, this.beforeAgentStart.bind(this));
		pi.on(SESSION_SHUTDOWN_EVENT, this.sessionShutdown.bind(this));
	}

	private sessionStart(_event: unknown, ctx: ExtensionContext): void {
		this.worker?.cancel();
		this.worker = undefined;
		this.sessionGeneration += 1;
		this.sessionCwd = ctx.cwd;
		this.sessionCwdReference.current = this.sessionCwd;
		this.herdrAvailable = isInsideHerdr();
		this.hasClaim = false;
		this.initialLabel = undefined;
		this.paneId = undefined;
		const isDisabled = !(this.shouldActivate?.(ctx) ?? true);
		const shouldSkip = !this.herdrAvailable || isDisabled;
		if (shouldSkip) return;
		this.paneId = process.env.HERDR_PANE_ID;
		try {
			this.initialLabel = tabLabel(this.commandRunner);
		} catch {
			this.initialLabel = undefined;
		}
		const claimedByWorktree = claimWorktreeTab(
			this.commandRunner,
			this.sessionCwd,
		);
		if (claimedByWorktree) this.hasClaim = true;
	}

	private beforeAgentStart(
		event: { prompt?: string },
		ctx: ExtensionContext,
	): void {
		const isUnavailable = !this.herdrAvailable;
		const isClaimed = this.hasClaim;
		const hasWorker = this.worker !== undefined;
		const isUnavailableOrClaimed = isUnavailable || isClaimed;
		const shouldSkip = isUnavailableOrClaimed || hasWorker;
		if (shouldSkip) return;
		const attempt = structuredClone<TabClaimAttempt>({
			generation: this.sessionGeneration,
			initialLabel: this.initialLabel,
			paneId: this.paneId,
		});
		try {
			this.worker = this.startWorker({
				prompt: event.prompt ?? "",
				instructions: TAB_CLAIM_INSTRUCTIONS,
				onClaimComplete: this.completeClaim.bind(this, ctx, attempt),
				onFailure: this.failClaim.bind(this, ctx, attempt.generation),
			});
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			this.failClaim(
				ctx,
				attempt.generation,
				`${TAB_CLAIM_START_FAILED}${detail}`,
			);
		}
	}

	private completeClaim(
		ctx: ExtensionContext,
		attempt: TabClaimAttempt,
		claim?: Parameters<ClaimWorkerRequest["onClaimComplete"]>[0],
	): void {
		const isCurrentGeneration = attempt.generation === this.sessionGeneration;
		if (!isCurrentGeneration) return;
		this.worker = undefined;
		const isValidated = hasValidatedTabClaim(
			this.commandRunner,
			attempt.initialLabel,
			attempt.paneId,
			claim,
		);
		if (isValidated) {
			this.hasClaim = true;
			return;
		}
		this.notify(ctx, TAB_CLAIM_FAILED, WARNING_LEVEL);
	}

	private failClaim(
		ctx: ExtensionContext,
		generation: number,
		message: string,
	): void {
		const isCurrentGeneration = generation === this.sessionGeneration;
		if (!isCurrentGeneration) return;
		this.worker = undefined;
		this.notify(ctx, message, WARNING_LEVEL);
	}

	private sessionShutdown(): void {
		this.sessionGeneration += 1;
		this.worker?.cancel();
		this.worker = undefined;
		this.hasClaim = false;
		this.herdrAvailable = false;
	}

	private notify(
		ctx: Pick<ExtensionContext, "ui">,
		message: string,
		level: "warning",
	): void {
		try {
			ctx.ui.notify(message, level);
		} catch {
			// Headless sessions have no user-facing UI.
		}
	}
}

export function installHerdrTabClaim(
	pi: ExtensionAPI,
	options: HerdrTabOptions = {},
): void {
	const shouldSkip = isSubagent();
	if (shouldSkip) return;
	new HerdrTabClaim(pi, options);
}
