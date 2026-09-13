import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export interface GitState {
	remoteOrigin?: string;
	mergeCompletedAt?: string;
	branch?: string | null;
	isWorktree?: boolean;
	worktreeRoot?: string | null;
	mainRoot?: string | null;
	hasUncommittedChanges?: boolean;
}

export interface SessionRecord {
	context: ExtensionContext;
	project: {
		codingRoot: string;
		todoistProjectRef: string;
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
