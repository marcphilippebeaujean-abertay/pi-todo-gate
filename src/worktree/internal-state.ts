import type { EventHandler } from "../shared/events.ts";
import type { SessionState } from "../state.ts";

export interface WorktreeCleanupTarget {
	worktreePath: string;
	branch: string;
	mainRoot: string;
}

export interface WorktreeCurrentState {
	currentHead: string;
	currentStatus: string;
}

export interface WorktreeModuleOptions {
	eventHandler: EventHandler;
	sessionState: SessionState;
	exec?: import("../shared/command.ts").Exec;
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
