import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { PromptQueue } from "../prompt-queue.ts";
import type {
	JsonValue,
	ModuleStateDescriptor,
} from "../session-state-persistence.ts";
import type { Exec } from "../shared/command.ts";
import type { EventHandler } from "../shared/events.ts";
import type { SessionRecord } from "../shared/session-state.ts";
import type { PrModuleState, SessionState } from "../state.ts";

export type PrState = Partial<PrModuleState>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function testedStrings(values: unknown[]): string[] {
	return values.filter((value): value is string => typeof value === "string");
}

function isMergedPr(value: unknown): value is MergedPr {
	if (!isRecord(value)) return false;
	return (
		typeof value.prUrl === "string" &&
		typeof value.detectedAt === "string" &&
		typeof value.reminderPending === "boolean"
	);
}

function restorePrState(value: unknown): PrModuleState {
	if (!isRecord(value)) return initialPrState();
	const hasValidPrUrl =
		value.prUrl === undefined || typeof value.prUrl === "string";
	const hasValidDiscoveryDisabled =
		typeof value.discoveryDisabled === "boolean";
	const hasValidTestedUrls =
		Array.isArray(value.discoveryTestedUrls) &&
		value.discoveryTestedUrls.every((entry) => typeof entry === "string");
	const hasValidMergedPrs =
		Array.isArray(value.mergedPrs) && value.mergedPrs.every(isMergedPr);
	if (
		!hasValidPrUrl ||
		!hasValidDiscoveryDisabled ||
		!hasValidTestedUrls ||
		!hasValidMergedPrs
	)
		return initialPrState();
	const discoveryDisabled = value.discoveryDisabled as boolean;
	const discoveryTestedUrls = value.discoveryTestedUrls as unknown[];
	const mergedPrs = value.mergedPrs as MergedPr[];
	return {
		...(value.prUrl === undefined ? {} : { prUrl: value.prUrl as string }),
		discoveryDisabled,
		discoveryTestedUrls: [...new Set(testedStrings(discoveryTestedUrls))],
		mergedPrs,
	};
}

function initialPrState(): PrModuleState {
	return { discoveryDisabled: false, discoveryTestedUrls: [], mergedPrs: [] };
}

export const prStateDescriptor: ModuleStateDescriptor<"pr"> = {
	id: "pr",
	createInitialState: initialPrState,
	restore: restorePrState,
	serialize: (state): JsonValue =>
		structuredClone(state) as unknown as JsonValue,
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
	refreshFooterStatuses(session: PrSession): void;
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
	isDiscoveryAllowed(
		stateEntry: Record<string, unknown> | null,
		state: PrState,
		hasPendingHandoffContext: boolean,
	): boolean;
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
