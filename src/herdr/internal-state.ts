import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { EventHandler } from "../shared/events.ts";
import type {
	PiWorkerProcess,
	PiWorkerSpawner,
} from "../shared/pi-worker-data.ts";
import type { SessionState } from "../state.ts";
import type { HerdrEvents } from "./events.ts";
import type { HerdrModuleState } from "./module-state.ts";

export type HerdrState = HerdrModuleState;

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
	attemptId: number;
	lifecycleEpoch?: number;
	events: HerdrEvents;
}

export interface ClaimWorkerOptions {
	command?: string;
	cwd?: string;
	spawnWorker?: PiWorkerSpawner;
}

export interface CwdReference {
	current: string;
}

export interface TabClaimAttempt {
	attemptId: number;
	lifecycleEpoch: number;
	initialLabel: string | undefined;
	tabId: string | undefined;
	paneId: string | undefined;
	context: ExtensionContext;
}

export interface ClaimWorkerHandle {
	cancel(): void;
}

export type WorkerProcess = PiWorkerProcess;
export type WorkerSpawner = PiWorkerSpawner;

export type CommandRunner = (command: string, args: string[]) => string;
export type StartBackgroundWorker = (
	request: ClaimWorkerRequest,
) => ClaimWorkerHandle;

export interface HerdrModuleSetupOptions {
	eventHandler: EventHandler;
	sessionState: SessionState;
	getLifecycleEpoch?: () => number;
	commandRunner?: CommandRunner;
	spawnWorker?: WorkerSpawner;
}

export interface HerdrTabOptions {
	commandRunner?: CommandRunner;
	getLifecycleEpoch?: () => number;
	cwd?: string;
	startBackgroundWorker?: StartBackgroundWorker;
	spawnWorker?: WorkerSpawner;
	shouldActivate?: (ctx: ExtensionContext) => boolean;
	publishClaimInProgress?: (claimInProgress: boolean) => void | Promise<void>;
	hasClaimReturnedSuccessfully?: (ctx: ExtensionContext) => boolean;
	onClaimReturnedSuccessfully?: (ctx: ExtensionContext) => void | Promise<void>;
}
