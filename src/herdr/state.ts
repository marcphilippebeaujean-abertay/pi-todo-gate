import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type {
	PiWorkerProcess,
	PiWorkerSpawner,
} from "../shared/pi-worker-data.ts";
import type { ClaimWorkerRequest, FooterEventSink } from "./events.ts";
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
