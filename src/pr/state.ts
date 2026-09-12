import type { Exec } from "../shared/command.ts";

export interface PrSession {
	context: { cwd: string; hasUI: boolean };
	state: { prUrl?: string };
	operationGeneration: number;
	operationQueue?: Promise<void>;
}

export interface PrRuntime {
	active: PrSession | null;
	dependencies: { exec?: Exec };
	events: {
		emit(
			event: string,
			payload: { prUrl: string; taskMarkedAsCompleted: boolean },
		): Promise<void>;
	};
	isCurrentOperation?(session: PrSession, generation: number): boolean;
	enqueueSessionOperation?<T>(
		session: PrSession,
		operation: () => Promise<T>,
	): Promise<T>;
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
