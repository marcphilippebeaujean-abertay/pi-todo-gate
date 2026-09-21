import type { EventHandler } from "../shared/events.ts";
import type { SessionState } from "../state.ts";

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

export interface CleanupOptions {
	exec: import("../shared/command.ts").Exec;
	changeDirectory: (path: string) => void;
	notify: (message: string, level?: "info" | "warning") => void;
	worktreeRemoved?: { value: boolean };
}
