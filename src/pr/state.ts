import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { PromptQueue } from "../prompt-queue.ts";
import type { Exec } from "../shared/command.ts";
import type { EventHandler } from "../shared/events.ts";
import type { SessionRecord } from "../shared/session-state.ts";
import type { SessionState } from "../state.ts";

export interface PrWorkState {
	remoteOrigin?: string;
	prUrl?: string;
	taskUrl?: string;
	taskRef?: string;
	taskName?: string;
	inheritedFrom?: string;
	mergeCompletedAt?: string;
	todoistCompletionAttemptedAt?: string;
}

export type PrSession = SessionRecord;

export interface PrRuntime {
	sessionState: SessionState;
	eventHandler: EventHandler;
	dependencies: { exec?: Exec };
	getSession: () => PrSession | null;
	prState?: () => PrState;
	isCurrentOperation?(session: PrSession, generation: number): boolean;
	enqueueSessionOperation?<T>(
		session: PrSession,
		operation: () => Promise<T>,
	): Promise<T>;
}

export type StateToolParams =
	| { action: "status"; url?: string }
	| { action: "set_pr"; url?: string }
	| { action: "clear_pr"; url?: string }
	| { action: "clear_all"; url?: string };

export interface StateToolRuntime {
	pi: ExtensionAPI;
	registered: boolean;
	getSession?: () => PrSession | null;
	appendState(state: PrWorkState, prDiscoveryDisabled?: boolean): void;
	replaceSessionState(session: PrSession, state: PrWorkState): void;
	refreshFooterStatuses(session: PrSession): void;
	syncPrState?: (session: PrSession) => Promise<void> | void;
}

export interface PrModuleDependencies {
	exec?: Exec;
	appendState?: (state: PrWorkState, prDiscoveryDisabled?: boolean) => void;
	replaceSessionState?: (session: PrSession, state: PrWorkState) => void;
	refreshFooterStatuses?: (session: PrSession) => void;
}

export interface PrModuleOptions {
	promptQueue: PromptQueue;
	eventHandler: EventHandler;
	sessionState: SessionState;
	getSession: () => PrSession | null;
	getLifecycleEpoch?: () => number;
	dependencies?: PrModuleDependencies;
}

export interface PrModule {
	register(pi: ExtensionAPI): void;
	activateSession(session: PrSession): Promise<void>;
	deactivateSession(): void;
	syncSessionState(session: PrSession): Promise<void>;
	initializeRemoteOrigin(
		ctx: ExtensionContext,
		state: PrWorkState,
	): Promise<PrWorkState>;
	persistPrIfAvailable(text: string): Promise<void>;
	persistInitialPr(branch: readonly unknown[]): Promise<void>;
	isDiscoveryAllowed(
		stateEntry: Record<string, unknown> | null,
		state: PrWorkState,
		handoffContext: boolean,
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
	state: PrWorkState;
	workRevision: number;
	prUrl: string | undefined;
	allowPrDiscovery: boolean;
	operationGeneration: number;
}

export interface OriginRequest {
	operationGeneration: number;
	lifecycleEpoch: number;
	sessionId: string | null;
	session?: PrSession;
	identity?: PrSessionIdentity;
}

export interface PrState {
	remoteOrigin?: string;
	prUrl?: string;
	mergedPrs?: MergedPr[];
	discoveryDisabled?: boolean;
	discoveryTestedUrls?: string[];
	operationGeneration?: number;
	mergeCompletedAt?: string;
	todoistCompletionAttemptedAt?: string;
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
