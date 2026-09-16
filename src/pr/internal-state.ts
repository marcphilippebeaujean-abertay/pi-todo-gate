import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { Exec } from "../shared/command.ts";
import type { EventHandler } from "../shared/events.ts";
import type { SessionRecord } from "../shared/session-state.ts";
import type { SessionState } from "../state.ts";

import type { MergedPrState, PrModuleState } from "./module-state.ts";

export type PrState = PrModuleState;
export type PrStatePatch = Partial<PrState>;

export type PrSession = SessionRecord;
export type NotificationContext = Pick<ExtensionContext, "ui">;

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
	pi?: ExtensionAPI;
	eventHandler: EventHandler;
	sessionState: SessionState;
	exec?: Exec;
	/** @deprecated pass exec directly. */
	dependencies?: PrModuleDependencies;
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
	sessionId: string;
}

export interface OriginRequest {
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
