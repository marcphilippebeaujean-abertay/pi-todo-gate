import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export type JsonValue =
	| string
	| number
	| boolean
	| null
	| JsonValue[]
	| { [key: string]: JsonValue | undefined };

/** Generic descriptor contract; concrete state types belong to their modules. */
export interface ModuleStateDescriptor<K extends string, State> {
	id: K;
	createInitialState(): State;
	restore(value: unknown): State;
	serialize(state: State): JsonValue;
}

export interface SessionRecord {
	context: ExtensionContext;
	project: {
		codingRoot: string;
		triggersOnlyOnWorktree?: boolean;
	};
	hasPendingHandoffContext: boolean;
	hasPerformedAnyGitMutations: boolean;
	workRevision: number;
	operationGeneration: number;
	operationQueue: Promise<void>;
}

export interface SessionReader {
	getBranch(): unknown[];
	getSessionId(): string;
	getCwd(): string;
}
