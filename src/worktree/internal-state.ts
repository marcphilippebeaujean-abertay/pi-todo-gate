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
	changeDirectory?: (path: string) => void;
}

export interface WorktreeModuleOptions {
	eventHandler: EventHandler;
	sessionState: SessionState;
	exec?: import("../shared/command.ts").Exec;
	changeDirectory?: (path: string) => void;
	/** @deprecated pass module dependencies directly. */
	dependencies?: WorktreeModuleDependencies;
}

export interface WorktreeConsumer {
	getWorktreeInfo(): { worktreePath: string; branch: string } | null;
	removeWorktree(): Promise<
		import("../shared/exit-actions.ts").ExitActionResult
	>;
}

export interface CleanupOptions {
	exec: import("../shared/command.ts").Exec;
	changeDirectory: (path: string) => void;
	notify: (message: string, level?: "info" | "warning") => void;
	isCurrent: () => boolean;
	worktreeRemoved?: { value: boolean };
}
