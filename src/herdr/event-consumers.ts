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
	SESSION_SHUTDOWN_EVENT,
	SESSION_START_EVENT,
	TAB_CLAIM_FAILED,
	TAB_CLAIM_INSTRUCTIONS,
	TAB_CLAIM_START_FAILED,
} from "./constants.ts";
import type {
	ClaimWorkerHandle,
	ClaimWorkerRequest,
	CommandRunner,
	FooterEventSink,
	HerdrTabOptions,
	StartBackgroundWorker,
} from "./data.ts";
import {
	hideHerdrFooter,
	notifyHerdrFailure,
	showHerdrFooter,
} from "./notifications.ts";
import {
	hasValidatedTabClaim,
	tabNameIsParseableAsInt,
} from "./tab-validation.ts";

interface TabClaimAttempt {
	generation: number;
	initialLabel: string | undefined;
	paneId: string | undefined;
}

class HerdrTabClaim {
	private readonly commandRunner: CommandRunner;
	private readonly startWorker: StartBackgroundWorker;
	private readonly shouldActivate: HerdrTabOptions["shouldActivate"];
	private readonly emitFooter: FooterEventSink;
	private sessionCwd: string;
	private readonly sessionCwdReference = { current: process.cwd() };
	private worker: ClaimWorkerHandle | undefined;
	private sessionGeneration = 0;
	private herdrAvailable = false;
	private hasValidatedClaim = false;
	private herdrGateClaimProcessed = false;
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
		this.hasValidatedClaim = false;
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
		const isClaimed = this.hasValidatedClaim;
		const hasWorker = this.worker !== undefined;
		const hasProcessedGate = this.herdrGateClaimProcessed;
		const isUnavailableOrClaimed = isUnavailable || isClaimed;
		const isProcessedOrWorking = hasProcessedGate || hasWorker;
		const shouldSkip = isUnavailableOrClaimed || isProcessedOrWorking;
		if (shouldSkip) return;
		const attempt = structuredClone<TabClaimAttempt>({
			generation: this.sessionGeneration,
			initialLabel: this.initialLabel,
			paneId: this.paneId,
		});
		this.herdrGateClaimProcessed = true;
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
				false,
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
			this.hasValidatedClaim = true;
			return;
		}
		this.herdrGateClaimProcessed = true;
		notifyHerdrFailure(ctx, TAB_CLAIM_FAILED);
	}

	private failClaim(
		ctx: ExtensionContext,
		generation: number,
		message: string,
		workerFailed?: boolean,
	): void {
		const isCurrentGeneration = generation === this.sessionGeneration;
		if (!isCurrentGeneration) return;
		this.worker = undefined;
		hideHerdrFooter(this.emitFooter);
		const didWorkerFail = workerFailed ?? true;
		const shouldTriggerRetry =
			didWorkerFail && tabNameIsParseableAsInt(this.initialLabel);
		this.herdrGateClaimProcessed = !shouldTriggerRetry;
		notifyHerdrFailure(ctx, message);
	}

	private sessionShutdown(): void {
		this.sessionGeneration += 1;
		this.worker?.cancel();
		this.worker = undefined;
		hideHerdrFooter(this.emitFooter);
		this.hasValidatedClaim = false;
		this.herdrGateClaimProcessed = false;
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
