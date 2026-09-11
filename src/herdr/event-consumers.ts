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
	CLAIM_COMPLETED_EVENT,
	CLAIM_FAILED_EVENT,
	SESSION_SHUTDOWN_EVENT,
	SESSION_START_EVENT,
	TAB_CLAIM_FAILED,
	TAB_CLAIM_INSTRUCTIONS,
	TAB_CLAIM_START_FAILED,
} from "./constants.ts";
import type {
	ClaimCompletedEvent,
	ClaimFailedEvent,
	ClaimWorkerHandle,
	CommandRunner,
	FooterEventSink,
	HerdrEvents,
	HerdrTabOptions,
	StartBackgroundWorker,
} from "./data.ts";
import { createHerdrEvents } from "./events.ts";
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
	attemptId: number;
	generation: number;
	initialLabel: string | undefined;
	paneId: string | undefined;
	context: ExtensionContext;
}

class HerdrTabClaimConsumer {
	private readonly commandRunner: CommandRunner;
	private readonly startWorker: StartBackgroundWorker;
	private readonly shouldActivate: HerdrTabOptions["shouldActivate"];
	private readonly emitFooter: FooterEventSink;
	private readonly events: HerdrEvents;
	private sessionCwd: string;
	private readonly sessionCwdReference = { current: process.cwd() };
	private worker: ClaimWorkerHandle | undefined;
	private sessionGeneration = 0;
	private nextAttemptId = 0;
	private herdrAvailable = false;
	private hasValidatedClaim = false;
	private herdrGateClaimProcessed = false;
	private initialLabel: string | undefined;
	private paneId: string | undefined;
	private activeAttempt: TabClaimAttempt | undefined;

	constructor(pi: ExtensionAPI, options: HerdrTabOptions, events: HerdrEvents) {
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
		this.events = events;
		this.events.on(CLAIM_COMPLETED_EVENT, this.completeClaim.bind(this));
		this.events.on(CLAIM_FAILED_EVENT, this.failClaim.bind(this));
		pi.on(SESSION_START_EVENT, this.sessionStart.bind(this));
		pi.on(BEFORE_AGENT_START_EVENT, this.beforeAgentStart.bind(this));
		pi.on(SESSION_SHUTDOWN_EVENT, this.sessionShutdown.bind(this));
	}

	private sessionStart(_event: unknown, ctx: ExtensionContext): void {
		this.worker?.cancel();
		this.worker = undefined;
		this.activeAttempt = undefined;
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
		const attempt: TabClaimAttempt = {
			attemptId: ++this.nextAttemptId,
			generation: this.sessionGeneration,
			initialLabel: this.initialLabel,
			paneId: this.paneId,
			context: ctx,
		};
		this.activeAttempt = attempt;
		this.herdrGateClaimProcessed = true;
		try {
			this.worker = this.startWorker({
				prompt: event.prompt ?? "",
				instructions: TAB_CLAIM_INSTRUCTIONS,
				attemptId: attempt.attemptId,
				events: this.events,
			});
			showHerdrFooter(this.emitFooter);
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			this.failClaim({
				attemptId: attempt.attemptId,
				message: `${TAB_CLAIM_START_FAILED}${detail}`,
				workerFailed: true,
			});
		}
	}

	private isCurrentAttempt(attemptId: number): boolean {
		return this.activeAttempt?.attemptId === attemptId;
	}

	private completeClaim(event: ClaimCompletedEvent): void {
		const attempt = this.activeAttempt;
		const hasAttempt = attempt !== undefined;
		if (!hasAttempt) return;
		const isCurrentGeneration = attempt.generation === this.sessionGeneration;
		if (!isCurrentGeneration) return;
		const isCurrentAttempt = this.isCurrentAttempt(event.attemptId);
		if (!isCurrentAttempt) return;
		this.worker = undefined;
		this.activeAttempt = undefined;
		hideHerdrFooter(this.emitFooter);
		const isValidated = hasValidatedTabClaim(
			this.commandRunner,
			attempt.initialLabel,
			attempt.paneId,
			event.result,
		);
		if (isValidated) {
			this.hasValidatedClaim = true;
			return;
		}
		this.herdrGateClaimProcessed = true;
		notifyHerdrFailure(attempt.context, TAB_CLAIM_FAILED);
	}

	private failClaim(event: ClaimFailedEvent): void {
		const attempt = this.activeAttempt;
		const hasAttempt = attempt !== undefined;
		if (!hasAttempt) return;
		const isCurrentGeneration = attempt.generation === this.sessionGeneration;
		if (!isCurrentGeneration) return;
		const isCurrentAttempt = this.isCurrentAttempt(event.attemptId);
		if (!isCurrentAttempt) return;
		this.worker = undefined;
		this.activeAttempt = undefined;
		hideHerdrFooter(this.emitFooter);
		const shouldTriggerRetry =
			event.workerFailed && tabNameIsParseableAsInt(this.initialLabel);
		this.herdrGateClaimProcessed = !shouldTriggerRetry;
		notifyHerdrFailure(attempt.context, event.message);
	}

	private sessionShutdown(): void {
		this.sessionGeneration += 1;
		this.worker?.cancel();
		this.worker = undefined;
		this.activeAttempt = undefined;
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
	const events = createHerdrEvents();
	new HerdrTabClaimConsumer(pi, options ?? {}, events);
}
