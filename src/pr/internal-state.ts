import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { PromptQueue } from "../prompt-queue.ts";
import type { Exec } from "../shared/command.ts";
import type { EventHandler } from "../shared/events.ts";
import type { SessionRecord } from "../shared/session-state.ts";
import type { SessionState } from "../state.ts";

export type { MergedPrState, PrModuleState } from "./module-state.ts";

import type { MergedPrState, PrModuleState } from "./module-state.ts";

export { normalizePrState, prStateDescriptor } from "./module-state.ts";

export type PrState = PrModuleState;
export type PrStatePatch = Partial<PrState>;

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
	exec?: Exec;
	/** @deprecated pass exec directly. */
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
export interface MergedPr extends MergedPrState {}
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
