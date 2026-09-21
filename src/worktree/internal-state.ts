import type { EventHandler } from "../shared/events.ts";
import type { SessionState } from "../state.ts";

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

export interface CleanupOptions {
	exec: import("../shared/command.ts").Exec;
	notify: (message: string, level?: "info" | "warning") => void;
	worktreeRemoved?: { value: boolean };
}
