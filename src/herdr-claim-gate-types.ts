import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type {
	ClaimWorkerHandle,
	ClaimWorkerRequest,
	WorkerSpawner,
} from "./herdr-claim-worker.ts";
export type CommandRunner = (command: string, args: string[]) => string;
export type StartBackgroundWorker = (
	request: ClaimWorkerRequest,
) => ClaimWorkerHandle;

export interface ClaimGateOptions {
	commandRunner?: CommandRunner;
	cwd?: string;
	startBackgroundWorker?: StartBackgroundWorker;
	spawnWorker?: WorkerSpawner;
	shouldActivate?: (ctx: ExtensionContext) => boolean;
}
