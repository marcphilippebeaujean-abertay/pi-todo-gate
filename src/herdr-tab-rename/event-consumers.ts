import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { createModuleStatePublisher } from "../event-publishers.ts";
import type { BeforeAgentStartEvent } from "../shared/events.ts";
import {
	boundHerdrClient,
	isInsideHerdr,
	tabLabel,
} from "../shared/herdr-client.ts";
import { modelReference } from "../shared/pi-worker.ts";
import { isSubagent } from "../shared/session.ts";
import {
	BEFORE_AGENT_START_EVENT,
	HERDR_CLAIM_RETURNED,
	HERDR_COMMAND,
	LABEL_FLAG,
	NEW_TAB_FLAG,
	NO_FOCUS_FLAG,
	PANE_MOVE_ARGS,
	SESSION_SHUTDOWN_EVENT,
	TAB_CLAIM_ACTION_FAILED,
	TAB_CLAIM_FAILED,
	TAB_CLAIM_INSTRUCTIONS,
	TAB_CLAIM_START_FAILED,
	TAB_RENAME_ARGS,
} from "./constants.ts";
import { defaultStartWorker, publishHerdrLoading } from "./event-publishers.ts";
import {
	type ClaimCompletedEvent,
	type ClaimFailedEvent,
	createHerdrEvents,
} from "./events.ts";
import type {
	ClaimWorkerHandle,
	ClaimWorkerResponse,
	HerdrClient,
	HerdrTabRenameOptions,
	StartBackgroundWorker,
} from "./internal-state.ts";
import { notifyHerdrFailure } from "./notifications.ts";
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

class HerdrTabRenameConsumer {
	private readonly herdrClient: HerdrClient;
	private readonly startWorker: (
		cwd: string,
		request: Parameters<StartBackgroundWorker>[0],
	) => ClaimWorkerHandle;
	private readonly eventHandler: HerdrTabRenameOptions["eventHandler"];
	private readonly sessionState: HerdrTabRenameOptions["sessionState"];
	private readonly workers = new Set<ClaimWorkerHandle>();

	constructor(pi: ExtensionAPI, options: HerdrTabRenameOptions) {
		this.herdrClient = options.herdrClient ?? boundHerdrClient(process.cwd());
		this.eventHandler = options.eventHandler;
		this.sessionState = options.sessionState;
		const startBackgroundWorker = options.startBackgroundWorker;
		this.startWorker =
			startBackgroundWorker === undefined
				? (cwd, request) =>
						defaultStartWorker(cwd, options.spawnWorker, request)
				: (_cwd, request) => startBackgroundWorker(request);
		pi.on(BEFORE_AGENT_START_EVENT, this.beforeAgentStart.bind(this));
		pi.on(SESSION_SHUTDOWN_EVENT, this.sessionShutdown.bind(this));
	}

	private validationInputs(): {
		initialLabel: string | undefined;
		tabId: string | undefined;
		paneId: string | undefined;
	} {
		let initialLabel: string | undefined;
		try {
			initialLabel = tabLabel(this.herdrClient);
		} catch {
			initialLabel = undefined;
		}
		return {
			initialLabel,
			tabId: process.env.HERDR_TAB_ID,
			paneId: process.env.HERDR_PANE_ID,
		};
	}

	private beforeAgentStart(
		event: BeforeAgentStartEvent,
		ctx: ExtensionContext,
	): void {
		const isUnavailable = !isInsideHerdr();
		const hasStoredClaim =
			this.sessionState.moduleState.herdrTabRename
				.herdrClaimReturnedSuccessfully === HERDR_CLAIM_RETURNED;
		const shouldSkip = isUnavailable || hasStoredClaim;
		if (shouldSkip) return;
		const events = createHerdrEvents();
		const validationInputs = this.validationInputs();
		let worker: ClaimWorkerHandle | undefined;
		const releaseWorker = (): void => {
			if (worker !== undefined) this.workers.delete(worker);
		};
		events.claimCompletedEvent.subscribe((result) => {
			releaseWorker();
			return this.completeClaim(result, validationInputs);
		});
		events.claimFailedEvent.subscribe((failure) => {
			releaseWorker();
			return this.failClaim(failure);
		});
		void publishHerdrLoading(this.eventHandler, true);
		try {
			worker = this.startWorker(ctx.cwd, {
				prompt: event.prompt ?? "",
				instructions: TAB_CLAIM_INSTRUCTIONS,
				model: modelReference(ctx.model),
				events,
			});
			this.workers.add(worker);
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			void this.failClaim({
				message: `${TAB_CLAIM_START_FAILED}${detail}`,
				workerFailed: true,
			});
		}
	}

	private async completeClaim(
		event: ClaimCompletedEvent,
		validationInputs: {
			initialLabel: string | undefined;
			tabId: string | undefined;
			paneId: string | undefined;
		},
	): Promise<void> {
		try {
			try {
				applyClaimResponse(
					this.herdrClient,
					validationInputs.tabId,
					validationInputs.paneId,
					event.result,
				);
			} catch (error) {
				const detail = error instanceof Error ? error.message : String(error);
				await notifyHerdrFailure(
					this.eventHandler,
					`${TAB_CLAIM_ACTION_FAILED}: ${detail}`,
				);
				return;
			}
			const isValidated = hasValidatedTabClaim(
				this.herdrClient,
				validationInputs.initialLabel,
				validationInputs.paneId,
				event.result,
			);
			if (!isValidated) {
				await notifyHerdrFailure(this.eventHandler, TAB_CLAIM_FAILED);
				return;
			}
			const publisher = createModuleStatePublisher(
				this.eventHandler,
				"herdrTabRename",
			);
			await publisher.publish(
				{
					...this.sessionState.moduleState.herdrTabRename,
					herdrClaimReturnedSuccessfully: HERDR_CLAIM_RETURNED,
				},
				{ persist: true },
			);
		} finally {
			await publishHerdrLoading(this.eventHandler, false);
		}
	}

	private async failClaim(event: ClaimFailedEvent): Promise<void> {
		try {
			await notifyHerdrFailure(this.eventHandler, event.message);
		} finally {
			await publishHerdrLoading(this.eventHandler, false);
		}
	}

	private sessionShutdown(): void {
		for (const worker of this.workers) worker.cancel();
		this.workers.clear();
	}
}

export function installHerdrTabRename(
	pi: ExtensionAPI,
	options: HerdrTabRenameOptions,
): void {
	const shouldSkip = isSubagent();
	if (shouldSkip) return;
	new HerdrTabRenameConsumer(pi, options);
}
