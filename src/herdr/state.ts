import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type {
	PiWorkerProcess,
	PiWorkerSpawner,
} from "../shared/pi-worker-data.ts";
import type {
	HerdrModuleState,
	JsonValue,
	ModuleStateDescriptor,
} from "../shared/session-state.ts";
import type { HerdrEvents } from "./events.ts";

export type HerdrState = HerdrModuleState;

function isRecord(value: unknown): value is Record<string, unknown> {
	const isObjectValue = typeof value === "object" && value !== null;
	const isArrayValue = Array.isArray(value);
	return isObjectValue && !isArrayValue;
}

function restoreHerdrState(value: unknown): HerdrState {
	const isHerdrRecord = isRecord(value);
	if (!isHerdrRecord) return {};
	const marker = value.herdrClaimReturnedSuccessfully;
	const hasInvalidMarker = marker !== undefined && typeof marker !== "string";
	if (hasInvalidMarker) return {};
	const hasMarker = marker !== undefined;
	if (hasMarker) return { herdrClaimReturnedSuccessfully: marker as string };
	return {};
}

export const herdrStateDescriptor: ModuleStateDescriptor<"herdr"> = {
	id: "herdr",
	createInitialState: () => ({}),
	restore: restoreHerdrState,
	serialize: (state): JsonValue => {
		const { claimInProgress: _claimInProgress, ...durableState } = state;
		return structuredClone(durableState) as JsonValue;
	},
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
	publishClaimInProgress?: (claimInProgress: boolean) => void | Promise<void>;
	hasClaimReturnedSuccessfully?: (ctx: ExtensionContext) => boolean;
	onClaimReturnedSuccessfully?: (ctx: ExtensionContext) => void | Promise<void>;
}
