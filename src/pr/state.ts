import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { PromptQueue } from "../prompt-queue.ts";
import type { Exec } from "../shared/command.ts";
import type { EventHandler } from "../shared/events.ts";
import type {
	JsonValue,
	ModuleStateDescriptor,
	PrModuleState,
	SessionRecord,
} from "../shared/session-state.ts";
import type { SessionState } from "../state.ts";

export type PrState = PrModuleState;
export type PrStatePatch = Partial<PrState>;

function isRecord(value: unknown): value is Record<string, unknown> {
	const isObjectValue = typeof value === "object" && value !== null;
	const isArrayValue = Array.isArray(value);
	return isObjectValue && !isArrayValue;
}

function normalizeUrl(value: unknown): string | undefined {
	const isEmpty = typeof value !== "string" || value.trim() === "";
	if (isEmpty) return undefined;
	return value;
}

function testedStrings(values: unknown[]): string[] {
	return [
		...new Set(
			values.flatMap((value) => {
				const url = normalizeUrl(value);
				return url === undefined ? [] : [url];
			}),
		),
	];
}

function isMergedPr(value: unknown): value is MergedPr {
	const isMergedPrRecord = isRecord(value);
	if (!isMergedPrRecord) return false;
	const validityChecks = [
		typeof value.prUrl === "string",
		typeof value.detectedAt === "string",
		typeof value.reminderPending === "boolean",
	];
	return validityChecks.every(Boolean);
}

function restorePrState(value: unknown): PrModuleState {
	const isPrRecord = isRecord(value);
	if (!isPrRecord) return initialPrState();
	const hasValidPrUrl =
		value.prUrl === undefined || typeof value.prUrl === "string";
	const hasValidDiscoveryDisabled =
		typeof value.discoveryDisabled === "boolean";
	const testedUrlsValue = value.discoveryTestedUrls;
	const hasTestedUrlsArray = Array.isArray(testedUrlsValue);
	const hasValidTestedUrls = hasTestedUrlsArray
		? (testedUrlsValue as unknown[]).every((entry) => typeof entry === "string")
		: false;
	const mergedPrsValue = value.mergedPrs;
	const hasMergedPrsArray = Array.isArray(mergedPrsValue);
	const hasValidMergedPrs = hasMergedPrsArray
		? (mergedPrsValue as unknown[]).every(isMergedPr)
		: false;
	const validityChecks = [
		hasValidPrUrl,
		hasValidDiscoveryDisabled,
		hasValidTestedUrls,
		hasValidMergedPrs,
	];
	const hasValidState = validityChecks.every(Boolean);
	if (!hasValidState) return initialPrState();
	const discoveryDisabled = value.discoveryDisabled as boolean;
	const discoveryTestedUrls = value.discoveryTestedUrls as unknown[];
	const mergedPrs = value.mergedPrs as MergedPr[];
	const prUrl = normalizeUrl(value.prUrl);
	return {
		...(prUrl === undefined ? {} : { prUrl }),
		discoveryDisabled,
		discoveryTestedUrls: testedStrings(discoveryTestedUrls),
		mergedPrs,
	};
}

export function normalizePrState(state: PrModuleState): PrModuleState {
	const prUrl = normalizeUrl(state.prUrl);
	return {
		...(prUrl === undefined ? {} : { prUrl }),
		discoveryDisabled: state.discoveryDisabled,
		discoveryTestedUrls: testedStrings(state.discoveryTestedUrls),
		mergedPrs: state.mergedPrs,
	};
}

function initialPrState(): PrModuleState {
	return { discoveryDisabled: false, discoveryTestedUrls: [], mergedPrs: [] };
}

export const prStateDescriptor: ModuleStateDescriptor<"pr"> = {
	id: "pr",
	createInitialState: initialPrState,
	restore: restorePrState,
	serialize: (state): JsonValue => {
		const prUrl = normalizeUrl(state.prUrl);
		return structuredClone({
			...(prUrl === undefined ? {} : { prUrl }),
			discoveryDisabled: state.discoveryDisabled,
			discoveryTestedUrls: testedStrings(state.discoveryTestedUrls),
			mergedPrs: state.mergedPrs,
		}) as unknown as JsonValue;
	},
};

export type PrSession = SessionRecord;

export interface PrCommandOptions {
	readonly sessionState: SessionState;
	readonly eventHandler: EventHandler;
	readonly exec?: Exec;
	readonly getSession: () => PrSession | null;
	readonly getLifecycleEpoch?: () => number;
	readonly getPrState: () => PrState;
	readonly getOperationGeneration: () => number;
	readonly isCurrentOperation: (
		session: PrSession,
		generation: number,
	) => boolean;
	readonly enqueueSessionOperation: <T>(
		session: PrSession,
		operation: () => Promise<T>,
	) => Promise<T>;
}

export type StateToolParams =
	| { action: "status"; url?: string }
	| { action: "set_pr"; url?: string }
	| { action: "clear_pr"; url?: string }
	| { action: "clear_all"; url?: string };

export interface StateToolDependencies {
	getSession: () => PrSession | null;
	getPrState: () => PrState;
	getRemoteOrigin: () => string | undefined;
	updatePrState: (state: PrState, persist: boolean) => Promise<void> | void;
	syncPrState?: (session: PrSession) => Promise<void> | void;
}

export interface PrModuleDependencies {
	exec?: Exec;
}

export interface PrModuleOptions {
	promptQueue: PromptQueue;
	pi?: ExtensionAPI;
	eventHandler: EventHandler;
	sessionState: SessionState;
	getLifecycleEpoch?: () => number;
	dependencies?: PrModuleDependencies;
}

export interface PrModule {
	activateSession(session: PrSession): Promise<void>;
	deactivateSession(): void;
	syncSessionState(session: PrSession): Promise<void>;
	initializeRemoteOrigin(
		ctx: ExtensionContext,
		remoteOrigin?: string,
	): Promise<string | undefined>;
	persistPrIfAvailable(text: string): Promise<void>;
	persistInitialPr(branch: readonly unknown[]): Promise<void>;
	appendBeforeAgentPrompt(
		ctx: ExtensionContext,
		messages: string[],
	): Promise<void>;
	isCurrentMerge(
		session: PrSession,
		workRevision: number,
		operationGeneration: number,
		taskRef: string | undefined,
		prUrl: string,
	): boolean;
}

export interface OpenPrInfo {
	url: string | null;
	state: "OPEN" | "CLOSED" | "MERGED" | "UNKNOWN";
}
export interface MergedPr {
	prUrl: string;
	detectedAt: string;
	reminderPending: boolean;
}
export interface PrSessionIdentity {
	workRevision: number;
	prUrl: string | undefined;
	discoveryDisabled: boolean;
	operationGeneration: number;
}

export interface OriginRequest {
	operationGeneration: number;
	lifecycleEpoch: number;
	sessionId: string | null;
	session?: PrSession;
	identity?: PrSessionIdentity;
}

export interface ParsedMerge {
	kind: "git" | "gh";
	args: string[];
}

export type QuoteCharacter = "'" | '"';
export interface ShellState {
	current: string;
	quote: QuoteCharacter | null;
	escaped: boolean;
}
