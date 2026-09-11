import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type {
	PiWorkerProcess,
	PiWorkerSpawner,
} from "../shared/pi-worker-data.ts";

export type FooterEventSink = (event: {
	footerType: string;
	isLoading: boolean;
	text: string;
	isVisible: boolean;
}) => void;

export interface ClaimCompletedEvent {
	attemptId: number;
	result?: import("./claim-worker-result.ts").ClaimWorkerResult;
}

export interface ClaimFailedEvent {
	attemptId: number;
	message: string;
	workerFailed: boolean;
}

export interface HerdrEventPayloads {
	claimCompleted: ClaimCompletedEvent;
	claimFailed: ClaimFailedEvent;
}

export type HerdrEventName = keyof HerdrEventPayloads;
export type HerdrEventListener<K extends HerdrEventName> = (
	payload: HerdrEventPayloads[K],
) => void;

export interface HerdrEvents {
	on<K extends HerdrEventName>(
		event: K,
		listener: HerdrEventListener<K>,
	): () => void;
	emit<K extends HerdrEventName>(
		event: K,
		payload: HerdrEventPayloads[K],
	): void;
}

export interface CwdReference {
	current: string;
}

export interface TabClaimAttempt {
	attemptId: number;
	initialLabel: string | undefined;
	paneId: string | undefined;
	context: ExtensionContext;
}

export interface ClaimWorkerRequest {
	prompt: string;
	instructions: string;
	attemptId: number;
	events: HerdrEvents;
}

export interface ClaimWorkerHandle {
	cancel(): void;
}

export interface ClaimWorkerOptions {
	command?: string;
	cwd?: string;
	spawnWorker?: WorkerSpawner;
}

export type WorkerProcess = PiWorkerProcess;
export type WorkerSpawner = PiWorkerSpawner;

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
	onFooterUpdate?: FooterEventSink;
}

export type { ClaimWorkerResult } from "./claim-worker-result.ts";
export { appendBounded, parseClaimResult } from "./claim-worker-result.ts";
export {
	hasValidatedTabClaim,
	tabNameIsParseableAsInt,
} from "./tab-validation.ts";
