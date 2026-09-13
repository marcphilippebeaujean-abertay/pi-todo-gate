import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type {
	JsonValue,
	ModuleStateDescriptor,
} from "../session-state-persistence.ts";
import type {
	PiWorkerProcess,
	PiWorkerSpawner,
} from "../shared/pi-worker-data.ts";
import type { HerdrModuleState } from "../state.ts";
import type { FooterEventSink, HerdrEvents } from "./events.ts";

export type HerdrState = HerdrModuleState;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function restoreHerdrState(value: unknown): HerdrState {
	if (!isRecord(value)) return {};
	const marker = value.herdrClaimReturnedSuccessfully;
	if (marker !== undefined && typeof marker !== "string") return {};
	return marker === undefined ? {} : { herdrClaimReturnedSuccessfully: marker };
}

export const herdrStateDescriptor: ModuleStateDescriptor<"herdr"> = {
	id: "herdr",
	createInitialState: () => ({}),
	restore: restoreHerdrState,
	serialize: (state): JsonValue => structuredClone(state) as JsonValue,
};

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

export interface HerdrTabOptions {
	commandRunner?: CommandRunner;
	cwd?: string;
	startBackgroundWorker?: StartBackgroundWorker;
	spawnWorker?: WorkerSpawner;
	shouldActivate?: (ctx: ExtensionContext) => boolean;
	onFooterUpdate?: FooterEventSink;
	hasClaimReturnedSuccessfully?: (ctx: ExtensionContext) => boolean;
	onClaimReturnedSuccessfully?: (ctx: ExtensionContext) => void;
}
