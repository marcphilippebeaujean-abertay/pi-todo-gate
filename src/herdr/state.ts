import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type {
	PiWorkerProcess,
	PiWorkerSpawner,
} from "../shared/pi-worker-data.ts";
import type { ClaimCompletedEvent, ClaimFailedEvent } from "./events.ts";

export interface ClaimWorkerResponse {
	status: "claimed";
	tabId: string;
	label: string;
}

export const CLAIM_WORKER_RESPONSE_TEMPLATE: ClaimWorkerResponse = {
	status: "claimed",
	tabId: "<current-tab-id>",
	label: "<current-tab-label>",
};

export interface ClaimWorkerResult {
	tabId: string;
	label: string;
}

export type HerdrEventPayloads = {
	claimCompleted: ClaimCompletedEvent;
	claimFailed: ClaimFailedEvent;
};

export type HerdrEventName = keyof HerdrEventPayloads;
export type HerdrEventListener<K extends HerdrEventName> = (
	payload: HerdrEventPayloads[K],
) => void;
export type HerdrEvents = {
	on<K extends HerdrEventName>(
		event: K,
		listener: HerdrEventListener<K>,
	): () => void;
	emit<K extends HerdrEventName>(
		event: K,
		payload: HerdrEventPayloads[K],
	): void;
};
export type AnyListener = HerdrEventListener<HerdrEventName>;
export type ListenerSet = Set<AnyListener>;

export type FooterEventSink = (event: {
	footerType: string;
	isLoading: boolean;
	text: string;
	isVisible: boolean;
}) => void;

export interface ClaimWorkerRequest {
	prompt: string;
	instructions: string;
	attemptId: number;
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
	initialLabel: string | undefined;
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

export interface HerdrTabOptions {
	commandRunner?: CommandRunner;
	cwd?: string;
	startBackgroundWorker?: StartBackgroundWorker;
	spawnWorker?: WorkerSpawner;
	shouldActivate?: (ctx: ExtensionContext) => boolean;
	onFooterUpdate?: FooterEventSink;
}
