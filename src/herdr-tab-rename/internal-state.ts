import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { EventHandler } from "../shared/events.ts";
import type { HerdrClient } from "../shared/herdr-client.ts";
import type {
	PiWorkerProcess,
	PiWorkerSpawner,
} from "../shared/pi-worker-data.ts";
import type { SessionState } from "../state.ts";
import type { HerdrEvents } from "./events.ts";
import type { HerdrTabRenameModuleState } from "./module-state.ts";

export type HerdrState = HerdrTabRenameModuleState;

export interface ClaimWorkerResponseData {
	tabName: string;
	shouldMoveToNewTab: boolean;
}

export type ClaimWorkerResponse = ClaimWorkerResponseData | null;

export const CLAIM_WORKER_RESPONSE_TEMPLATE: ClaimWorkerResponseData = {
	tabName: "<current-tab-label>",
	shouldMoveToNewTab: false,
};

export interface ClaimWorkerRequest {
	prompt: string;
	instructions: string;
	model?: string;
	events: HerdrEvents;
}

export interface ClaimWorkerOptions {
	command?: string;
	cwd?: string;
	spawnWorker?: PiWorkerSpawner;
}

export interface ClaimWorkerHandle {
	cancel(): void;
}

export type WorkerProcess = PiWorkerProcess;
export type WorkerSpawner = PiWorkerSpawner;

export type { HerdrClient } from "../shared/herdr-client.ts";
export type StartBackgroundWorker = (
	request: ClaimWorkerRequest,
) => ClaimWorkerHandle;

export interface HerdrTabRenameModuleSetupOptions {
	eventHandler: EventHandler;
	sessionState: SessionState;
	herdrClient?: HerdrClient;
	spawnWorker?: WorkerSpawner;
}

export interface HerdrTabRenameOptions {
	herdrClient?: HerdrClient;
	sessionState?: SessionState;
	startBackgroundWorker?: StartBackgroundWorker;
	spawnWorker?: WorkerSpawner;
	shouldActivate?: (ctx: ExtensionContext) => boolean;
	publishClaimInProgress?: (claimInProgress: boolean) => void | Promise<void>;
	hasClaimReturnedSuccessfully?: (ctx: ExtensionContext) => boolean;
	onClaimReturnedSuccessfully?: (ctx: ExtensionContext) => void | Promise<void>;
}
