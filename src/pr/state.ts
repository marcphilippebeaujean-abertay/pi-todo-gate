import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Exec } from "../shared/command.ts";
import type { EventHandler } from "../shared/events.ts";
import type { SessionContext, SessionState } from "../state.ts";

export interface PrSession {
	context: { cwd: string; hasUI: boolean };
	state: { prUrl?: string };
	operationGeneration: number;
	operationQueue?: Promise<void>;
}

export interface PrModule {
	register(pi: ExtensionAPI): void;
}

export interface PrRuntime {
	sessionState: SessionState;
	eventHandler: EventHandler;
	dependencies: { exec?: Exec };
	isCurrentOperation?(session: PrSession, generation: number): boolean;
	enqueueSessionOperation?<T>(
		session: PrSession,
		operation: () => Promise<T>,
	): Promise<T>;
}

export interface StateToolRuntime {
	pi: ExtensionAPI;
	registered: boolean;
	sessionState: SessionState;
	appendState(
		state: SessionContext["state"],
		prDiscoveryDisabled?: boolean,
	): void;
	refreshFooterStatuses(session: SessionContext): void;
	replaceSessionState(
		session: SessionContext,
		nextState: SessionContext["state"],
	): void;
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
export interface PrState {
	prUrl?: string;
	mergedPrs?: MergedPr[];
	discoveryDisabled?: boolean;
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
