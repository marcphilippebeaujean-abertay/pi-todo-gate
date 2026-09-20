import type { EventHandler } from "../shared/events.ts";
import type { SessionState } from "../state.ts";

export interface WorktreeBaseline {
	worktreePath: string;
	branch: string;
	mainRoot: string;
	initialHead: string;
	initialStatus: string;
}

export interface WorktreeCurrentState {
	currentHead: string;
	currentStatus: string;
}

export interface WorktreeModuleDependencies {
	exec?: import("../shared/command.ts").Exec;
}

export interface WorktreeModuleOptions {
	eventHandler: EventHandler;
	sessionState: SessionState;
	exec?: import("../shared/command.ts").Exec;
	/** @deprecated pass module dependencies directly. */
	dependencies?: WorktreeModuleDependencies;
}

export interface WorktreeConsumer {
	getWorktreeInfo(): { worktreePath: string; branch: string } | null;
	hasUncommittedChanges(): Promise<boolean | null>;
	removeWorktree(options: {
		force: boolean;
	}): Promise<import("../shared/exit-actions.ts").ExitActionResult>;
}

export interface CleanupOptions {
	exec: import("../shared/command.ts").Exec;
	notify: (message: string, level?: "info" | "warning") => void;
	isCurrent: () => boolean;
	notifySession: (message: string) => Promise<void> | void;
	worktreeRemoved?: { value: boolean };
}
