import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { FooterEventSink } from "../../footer/data.ts";
import type {
	ClaimWorkerHandle,
	ClaimWorkerRequest,
	WorkerSpawner,
} from "./claim-worker.ts";

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
