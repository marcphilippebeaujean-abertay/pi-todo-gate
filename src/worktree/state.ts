import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PromptQueue } from "../prompt-queue.ts";
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
	formatPrStatus?: (
		url: string | undefined,
		theme: { fg(color: string, text: string): string } | undefined,
		hasUncommittedChanges: boolean,
	) => string;
	formatTaskStatus?: (
		url: string | undefined,
		theme: { fg(color: string, text: string): string } | undefined,
		name?: string,
	) => string;
}

export interface WorktreeModuleOptions {
	promptQueue: PromptQueue;
	eventHandler: EventHandler;
	sessionState: SessionState;
	dependencies?: WorktreeModuleDependencies;
}

export interface CleanupOptions {
	exec: import("../shared/command.ts").Exec;
	changeDirectory: (path: string) => void;
	notify: (message: string, level?: "info" | "warning") => void;
	isCurrent: () => boolean;
	worktreeRemoved?: { value: boolean };
}

export interface WorktreeInfo {
	worktreePath: string;
	branch: string;
}

export interface WorktreeModule {
	sessionStart(ctx: ExtensionContext): Promise<void>;
	deactivate(): void;
	getWorktreeInfo(): WorktreeInfo | null;
	removeWorktree(): Promise<
		import("../shared/exit-actions.ts").ExitActionResult
	>;
}
