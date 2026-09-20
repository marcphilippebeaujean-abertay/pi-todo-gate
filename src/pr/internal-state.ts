import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { ModuleStatePublisher } from "../event-publishers.ts";
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
	sessionState: SessionState;
	publisher: ModuleStatePublisher<"pr">;
}

export interface PrModuleOptions {
	pi?: ExtensionAPI;
	eventHandler: EventHandler;
	sessionState: SessionState;
	exec?: Exec;
}

export interface OpenPrInfo {
	url: string | null;
	state: "OPEN" | "CLOSED" | "MERGED" | "UNKNOWN";
}
export interface MergedPr extends MergedPrState {}

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
