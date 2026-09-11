import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { isSubagent } from "../session.ts";
import {
	boundCommandRunner,
	defaultStartWorker,
	isInsideHerdr,
	tabLabel,
} from "./commands.ts";
import {
	BEFORE_AGENT_START_EVENT,
	HERDR_STATE_TYPE,
	RAN,
	SESSION_SHUTDOWN_EVENT,
	SESSION_START_EVENT,
	TAB_CLAIM_FAILED,
	TAB_CLAIM_INSTRUCTIONS,
	TAB_CLAIM_START_FAILED,
} from "./constants.ts";
import type { FooterEventSink } from "./data.ts";
import {
	type ClaimWorkerHandle,
	type ClaimWorkerRequest,
	type CommandRunner,
	type HerdrTabOptions,
	hasHerdrClaimRun,
	hasValidatedTabClaim,
	type StartBackgroundWorker,
} from "./data.ts";
import {
	hideHerdrFooter,
	notifyHerdrFailure,
	showHerdrFooter,
} from "./notifications.ts";

interface TabClaimAttempt {
	generation: number;
	initialLabel: string | undefined;
	paneId: string | undefined;
}

class HerdrTabClaim {
	private readonly pi: ExtensionAPI;
	private readonly commandRunner: CommandRunner;
	private readonly startWorker: StartBackgroundWorker;
	private readonly shouldActivate: HerdrTabOptions["shouldActivate"];
	private readonly emitFooter: FooterEventSink;
	private sessionCwd: string;
	private readonly sessionCwdReference = { current: process.cwd() };
	private worker: ClaimWorkerHandle | undefined;
	private sessionGeneration = 0;
	private herdrAvailable = false;
	private hasClaim = false;
	private hasRun = false;
	private initialLabel: string | undefined;
	private paneId: string | undefined;

	constructor(pi: ExtensionAPI, options: HerdrTabOptions) {
		this.pi = pi;
		this.commandRunner =
			options.commandRunner ?? boundCommandRunner(this.sessionCwdReference);
		this.sessionCwd = options.cwd ?? process.cwd();
		this.sessionCwdReference.current = this.sessionCwd;
		this.startWorker =
			options.startBackgroundWorker ??
			((request) =>
				defaultStartWorker(this.sessionCwd, options.spawnWorker, request));
		this.shouldActivate = options.shouldActivate;
		this.emitFooter = options.onFooterUpdate ?? (() => undefined);
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
		this.hasRun = hasHerdrClaimRun(ctx.sessionManager.getBranch());
		this.initialLabel = undefined;
		this.paneId = undefined;
		hideHerdrFooter(this.emitFooter);
		const isDisabled = !(this.shouldActivate?.(ctx) ?? true);
		const shouldSkip = !this.herdrAvailable || isDisabled;
		if (shouldSkip) return;
		this.paneId = process.env.HERDR_PANE_ID;
		try {
			this.initialLabel = tabLabel(this.commandRunner);
		} catch {
			this.initialLabel = undefined;
		}
	}

	private beforeAgentStart(
		event: { prompt?: string },
		ctx: ExtensionContext,
	): void {
		const isUnavailable = !this.herdrAvailable;
		const isClaimed = this.hasClaim;
		const hasWorker = this.worker !== undefined;
		const hasAlreadyRun = this.hasRun;
		const isUnavailableOrClaimed = isUnavailable || isClaimed;
		const isAlreadyRunOrWorking = hasAlreadyRun || hasWorker;
		const shouldSkip = isUnavailableOrClaimed || isAlreadyRunOrWorking;
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
			showHerdrFooter(this.emitFooter);
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
		hideHerdrFooter(this.emitFooter);
		const isValidated = hasValidatedTabClaim(
			this.commandRunner,
			attempt.initialLabel,
			attempt.paneId,
			claim,
		);
		if (isValidated) {
			this.hasClaim = true;
			this.hasRun = true;
			this.pi.appendEntry(HERDR_STATE_TYPE, { [RAN]: true });
			return;
		}
		notifyHerdrFailure(ctx, TAB_CLAIM_FAILED);
	}

	private failClaim(
		ctx: ExtensionContext,
		generation: number,
		message: string,
	): void {
		const isCurrentGeneration = generation === this.sessionGeneration;
		if (!isCurrentGeneration) return;
		this.worker = undefined;
		hideHerdrFooter(this.emitFooter);
		notifyHerdrFailure(ctx, message);
	}

	private sessionShutdown(): void {
		this.sessionGeneration += 1;
		this.worker?.cancel();
		this.worker = undefined;
		hideHerdrFooter(this.emitFooter);
		this.hasClaim = false;
		this.hasRun = false;
		this.herdrAvailable = false;
	}
}

export function installHerdrTabClaim(
	pi: ExtensionAPI,
	options?: HerdrTabOptions,
): void {
	const shouldSkip = isSubagent();
	if (shouldSkip) return;
	new HerdrTabClaim(pi, options ?? {});
}
