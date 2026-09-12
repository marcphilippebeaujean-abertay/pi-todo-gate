import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export interface GitState {
	remoteOrigin?: string;
	branch?: string | null;
	isWorktree?: boolean;
	worktreeRoot?: string | null;
	mainRoot?: string | null;
	hasUncommittedChanges?: boolean;
}

export interface SessionStateSnapshot {
	sessionId: string | null;
	gitState: GitState;
	moduleState: Record<string, unknown>;
}

export interface WorkState {
	remoteOrigin?: string;
	prUrl?: string;
	taskUrl?: string;
	taskRef?: string;
	taskName?: string;
	inheritedFrom?: string;
	mergeCompletedAt?: string;
	todoistCompletionAttemptedAt?: string;
}

export interface SessionRecord {
	sessionId: string;
	context: ExtensionContext;
	project: {
		codingRoot: string;
		todoistProjectRef: string;
		triggersOnlyOnWorktree?: boolean;
	};
	state: WorkState;
	allowPrDiscovery: boolean;
	prDiscoveryTestedUrls: Set<string>;
	handoffContext: boolean;
	workChanged: boolean;
	hasUncommittedChanges: boolean;
	workRevision: number;
	operationGeneration: number;
	operationQueue: Promise<void>;
}

export interface SessionReader {
	getBranch(): unknown[];
	getSessionId(): string;
	getCwd(): string;
}
