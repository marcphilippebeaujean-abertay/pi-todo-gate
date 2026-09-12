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
