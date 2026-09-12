import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

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

export interface CleanupOptions {
	exec: import("../shared/command.ts").Exec;
	changeDirectory: (path: string) => void;
	notify: (message: string, level?: "info" | "warning") => void;
	isCurrent: () => boolean;
	worktreeRemoved?: { value: boolean };
}

export interface WorktreeModule {
	sessionStart(ctx: ExtensionContext): Promise<void>;
	deactivate(): void;
}
