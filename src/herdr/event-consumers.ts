import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { BeforeAgentStartEvent } from "../shared/events.ts";
import { modelReference } from "../shared/pi-worker.ts";
import { isSubagent } from "../shared/session.ts";
import {
	BEFORE_AGENT_START_EVENT,
	HERDR_COMMAND,
	LABEL_FLAG,
	NEW_TAB_FLAG,
	NO_FOCUS_FLAG,
	PANE_MOVE_ARGS,
	SESSION_SHUTDOWN_EVENT,
	SESSION_START_EVENT,
	TAB_CLAIM_ACTION_FAILED,
	TAB_CLAIM_FAILED,
	TAB_CLAIM_INSTRUCTIONS,
	TAB_CLAIM_START_FAILED,
	TAB_RENAME_ARGS,
} from "./constants.ts";
import { defaultStartWorker } from "./event-publishers.ts";
import {
	type ClaimCompletedEvent,
	type ClaimFailedEvent,
	createHerdrEvents,
	type HerdrEvents,
} from "./events.ts";
import type {
	ClaimWorkerHandle,
	ClaimWorkerResponse,
	HerdrClient,
	HerdrTabOptions,
	StartBackgroundWorker,
} from "./internal-state.ts";
import { notifyHerdrFailure } from "./notifications.ts";
import { boundHerdrClient, isInsideHerdr, tabLabel } from "./runtime.ts";
import { hasValidatedTabClaim } from "./tab-validation.ts";

function currentId(value: string | undefined, subject: "pane" | "tab"): string {
	const hasValue = value !== undefined;
	if (!hasValue) throw new Error(`current ${subject} ID unavailable`);
	return value;
}

function applyClaimResponse(
	herdrClient: HerdrClient,
	tabId: string | undefined,
	paneId: string | undefined,
	response: ClaimWorkerResponse | undefined,
): void {
	const hasNoResponse = response === undefined || response === null;
	if (hasNoResponse) return;
	switch (response.shouldMoveToNewTab) {
		case true: {
			const currentPaneId = currentId(paneId, "pane");
			herdrClient(HERDR_COMMAND, [
				...PANE_MOVE_ARGS,
				currentPaneId,
				NEW_TAB_FLAG,
				LABEL_FLAG,
				response.tabName,
				NO_FOCUS_FLAG,
			]);
			return;
		}
		case false: {
			const currentTabId = currentId(tabId, "tab");
			herdrClient(HERDR_COMMAND, [
				...TAB_RENAME_ARGS,
				currentTabId,
				response.tabName,
			]);
		}
	}
}

class HerdrTabClaimConsumer {
	private readonly herdrClient: HerdrClient;
	private readonly startWorker: StartBackgroundWorker;
	private readonly shouldActivate: HerdrTabOptions["shouldActivate"];
	private readonly hasStoredClaim: HerdrTabOptions["hasClaimReturnedSuccessfully"];
	private readonly onClaimReturnedSuccessfully: HerdrTabOptions["onClaimReturnedSuccessfully"];
	private readonly publishClaimInProgress: NonNullable<
		HerdrTabOptions["publishClaimInProgress"]
	>;
	private readonly events: HerdrEvents;
	private sessionCwd: string;
	private readonly sessionCwdReference = { current: process.cwd() };
	private worker: ClaimWorkerHandle | undefined;
	private herdrAvailable = false;
	private hasValidatedClaim = false;
	private hasClaimReturnedSuccessfully = false;
	private herdrBackgroundWorkerDispatched = false;
	private herdrBackgroundWorkerReturned = false;
	private initialLabel: string | undefined;
	private tabId: string | undefined;
	private paneId: string | undefined;
	private claimContext: ExtensionContext | undefined;

	constructor(pi: ExtensionAPI, options: HerdrTabOptions, events: HerdrEvents) {
		this.herdrClient =
			options.herdrClient ?? boundHerdrClient(this.sessionCwdReference);
		this.sessionCwd = options.cwd ?? process.cwd();
		this.sessionCwdReference.current = this.sessionCwd;
		this.startWorker =
			options.startBackgroundWorker ??
			((request) =>
				defaultStartWorker(this.sessionCwd, options.spawnWorker, request));
		this.shouldActivate = options.shouldActivate;
		this.hasStoredClaim = options.hasClaimReturnedSuccessfully;
		this.onClaimReturnedSuccessfully = options.onClaimReturnedSuccessfully;
		this.publishClaimInProgress =
			options.publishClaimInProgress ?? (() => undefined);
		this.events = events;
		this.events.claimCompletedEvent.subscribe(this.completeClaim.bind(this));
		this.events.claimFailedEvent.subscribe(this.failClaim.bind(this));
		pi.on(SESSION_START_EVENT, this.sessionStart.bind(this));
		pi.on(BEFORE_AGENT_START_EVENT, this.beforeAgentStart.bind(this));
		pi.on(SESSION_SHUTDOWN_EVENT, this.sessionShutdown.bind(this));
	}

	private sessionStart(_event: unknown, ctx: ExtensionContext): void {
		this.worker?.cancel();
		this.worker = undefined;
		this.claimContext = undefined;
		this.sessionCwd = ctx.cwd;
		this.sessionCwdReference.current = this.sessionCwd;
		this.herdrAvailable = isInsideHerdr();
		const storedClaim = this.shouldHaveStoredClaim(ctx);
		this.hasClaimReturnedSuccessfully = storedClaim;
		this.hasValidatedClaim = storedClaim;
		this.initialLabel = undefined;
		this.tabId = undefined;
		this.paneId = undefined;
		this.publishClaimInProgress(false);
		const isDisabled = !(this.shouldActivate?.(ctx) ?? true);
		const shouldSkip = !this.herdrAvailable || isDisabled;
		if (shouldSkip) return;
		this.tabId = process.env.HERDR_TAB_ID;
		this.paneId = process.env.HERDR_PANE_ID;
		try {
			this.initialLabel = tabLabel(this.herdrClient);
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
		const isWorkerDispatched = this.herdrBackgroundWorkerDispatched;
		const isWorkerReturned = this.herdrBackgroundWorkerReturned;
		const isUnavailableOrClaimed = isUnavailable || isClaimed;
		const isWorkerDone = isWorkerDispatched || isWorkerReturned;
		const shouldSkip = isUnavailableOrClaimed || isWorkerDone;
		if (shouldSkip) return;
		this.herdrBackgroundWorkerDispatched = true;
		this.claimContext = ctx;
		try {
			this.worker = this.startWorker({
				prompt: event.prompt ?? "",
				instructions: TAB_CLAIM_INSTRUCTIONS,
				model: modelReference(ctx.model),
				events: this.events,
			});
			this.publishClaimInProgress(true);
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			this.failClaim({
				message: `${TAB_CLAIM_START_FAILED}${detail}`,
				workerFailed: true,
			});
		}
	}

	private async completeClaim(event: ClaimCompletedEvent): Promise<void> {
		const isWorkerDispatched = this.herdrBackgroundWorkerDispatched;
		const isWorkerReturned = this.herdrBackgroundWorkerReturned;
		const shouldIgnoreResult = !isWorkerDispatched || isWorkerReturned;
		if (shouldIgnoreResult) return;
		const context = this.claimContext;
		const hasClaimContext = context !== undefined;
		if (!hasClaimContext) return;
		this.herdrBackgroundWorkerReturned = true;
		this.worker = undefined;
		this.claimContext = undefined;
		const claimStatusUpdate = this.publishClaimInProgress(false);
		try {
			applyClaimResponse(
				this.herdrClient,
				this.tabId,
				this.paneId,
				event.result,
			);
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			notifyHerdrFailure(context, `${TAB_CLAIM_ACTION_FAILED}: ${detail}`);
			return;
		}
		const isValidated = hasValidatedTabClaim(
			this.herdrClient,
			this.initialLabel,
			this.paneId,
			event.result,
		);
		if (isValidated) {
			if (claimStatusUpdate instanceof Promise) await claimStatusUpdate;
			this.hasValidatedClaim = true;
			this.hasClaimReturnedSuccessfully = true;
			const markerUpdate = this.onClaimReturnedSuccessfully?.(context);
			if (markerUpdate instanceof Promise) await markerUpdate;
			return;
		}
		notifyHerdrFailure(context, TAB_CLAIM_FAILED);
	}

	private failClaim(event: ClaimFailedEvent): void {
		const isWorkerDispatched = this.herdrBackgroundWorkerDispatched;
		const isWorkerReturned = this.herdrBackgroundWorkerReturned;
		const shouldIgnoreResult = !isWorkerDispatched || isWorkerReturned;
		if (shouldIgnoreResult) return;
		const context = this.claimContext;
		const hasClaimContext = context !== undefined;
		if (!hasClaimContext) return;
		this.herdrBackgroundWorkerReturned = true;
		this.worker = undefined;
		this.claimContext = undefined;
		this.publishClaimInProgress(false);
		notifyHerdrFailure(context, event.message);
	}

	private sessionShutdown(): void {
		this.worker?.cancel();
		this.worker = undefined;
		this.claimContext = undefined;
		this.publishClaimInProgress(false);
		this.hasValidatedClaim = false;
		this.hasClaimReturnedSuccessfully = false;
		this.herdrBackgroundWorkerDispatched = false;
		this.herdrBackgroundWorkerReturned = false;
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
