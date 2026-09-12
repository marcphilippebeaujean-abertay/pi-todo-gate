import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { BeforeAgentStartEvent } from "../events.ts";
import { isSubagent } from "../session.ts";
import {
	BEFORE_AGENT_START_EVENT,
	CLAIM_COMPLETED_EVENT,
	CLAIM_FAILED_EVENT,
	HERDR_MAX_CLAIM_ATTEMPTS,
	SESSION_SHUTDOWN_EVENT,
	SESSION_START_EVENT,
	TAB_CLAIM_FAILED,
	TAB_CLAIM_INSTRUCTIONS,
	TAB_CLAIM_START_FAILED,
} from "./constants.ts";
import { defaultStartWorker } from "./event-publishers.ts";
import {
	type ClaimCompletedEvent,
	type ClaimFailedEvent,
	createHerdrEvents,
	type FooterEventSink,
	type HerdrEvents,
} from "./events.ts";
import {
	hideHerdrFooter,
	notifyHerdrFailure,
	showHerdrFooter,
} from "./notifications.ts";
import { boundCommandRunner, isInsideHerdr, tabLabel } from "./runtime.ts";
import type {
	ClaimWorkerHandle,
	CommandRunner,
	HerdrTabOptions,
	StartBackgroundWorker,
	TabClaimAttempt,
} from "./state.ts";
import {
	hasValidatedTabClaim,
	tabNameIsParseableAsInt,
} from "./tab-validation.ts";

class HerdrTabClaimConsumer {
	private readonly commandRunner: CommandRunner;
	private readonly startWorker: StartBackgroundWorker;
	private readonly shouldActivate: HerdrTabOptions["shouldActivate"];
	private readonly hasStoredClaim: HerdrTabOptions["hasClaimReturnedSuccessfully"];
	private readonly onClaimReturnedSuccessfully: HerdrTabOptions["onClaimReturnedSuccessfully"];
	private readonly emitFooter: FooterEventSink;
	private readonly events: HerdrEvents;
	private sessionCwd: string;
	private readonly sessionCwdReference = { current: process.cwd() };
	private worker: ClaimWorkerHandle | undefined;
	private nextAttemptId = 0;
	private herdrAvailable = false;
	private hasValidatedClaim = false;
	private herdrGateClaimProcessed = false;
	private hasClaimReturnedSuccessfully = false;
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
		this.hasStoredClaim = options.hasClaimReturnedSuccessfully;
		this.onClaimReturnedSuccessfully = options.onClaimReturnedSuccessfully;
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
		this.sessionCwd = ctx.cwd;
		this.sessionCwdReference.current = this.sessionCwd;
		this.herdrAvailable = isInsideHerdr();
		const storedClaim = this.shouldHaveStoredClaim(ctx);
		this.hasClaimReturnedSuccessfully = storedClaim;
		this.hasValidatedClaim = storedClaim;
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

	private shouldHaveStoredClaim(ctx: ExtensionContext): boolean {
		const storedClaim = this.hasStoredClaim?.(ctx);
		return storedClaim ?? this.hasClaimReturnedSuccessfully;
	}

	private beforeAgentStart(
		event: BeforeAgentStartEvent,
		ctx: ExtensionContext,
	): void {
		const isUnavailable = !this.herdrAvailable;
		const isClaimed =
			this.hasValidatedClaim || this.hasClaimReturnedSuccessfully;
		const hasWorker = this.worker !== undefined;
		const hasProcessedGate = this.herdrGateClaimProcessed;
		const isUnavailableOrClaimed = isUnavailable || isClaimed;
		const isProcessedOrWorking = hasProcessedGate || hasWorker;
		const shouldSkip = isUnavailableOrClaimed || isProcessedOrWorking;
		if (shouldSkip) return;
		const hasAttemptsRemaining = this.nextAttemptId < HERDR_MAX_CLAIM_ATTEMPTS;
		if (!hasAttemptsRemaining) return;
		const attempt: TabClaimAttempt = {
			attemptId: ++this.nextAttemptId,
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
			this.hasClaimReturnedSuccessfully = true;
			this.onClaimReturnedSuccessfully?.(attempt.context);
			this.nextAttemptId = 0;
			return;
		}
		this.herdrGateClaimProcessed = true;
		notifyHerdrFailure(attempt.context, TAB_CLAIM_FAILED);
	}

	private failClaim(event: ClaimFailedEvent): void {
		const attempt = this.activeAttempt;
		const hasAttempt = attempt !== undefined;
		if (!hasAttempt) return;
		const isCurrentAttempt = this.isCurrentAttempt(event.attemptId);
		if (!isCurrentAttempt) return;
		this.worker = undefined;
		this.activeAttempt = undefined;
		hideHerdrFooter(this.emitFooter);
		const isWorkerFailure = event.workerFailed;
		const isNumericTab = tabNameIsParseableAsInt(this.initialLabel);
		const hasAttemptsRemaining = this.nextAttemptId < HERDR_MAX_CLAIM_ATTEMPTS;
		const canRetry = isNumericTab && hasAttemptsRemaining;
		const shouldTriggerRetry = isWorkerFailure && canRetry;
		this.herdrGateClaimProcessed = !shouldTriggerRetry;
		notifyHerdrFailure(attempt.context, event.message);
	}

	private sessionShutdown(): void {
		this.worker?.cancel();
		this.worker = undefined;
		this.activeAttempt = undefined;
		hideHerdrFooter(this.emitFooter);
		this.hasValidatedClaim = false;
		this.herdrGateClaimProcessed = false;
		this.herdrAvailable = false;
		this.nextAttemptId = 0;
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
