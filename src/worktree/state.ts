import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { EMPTY } from "./constants.ts";

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

export function isCurrentWorktree(
	baseline: WorktreeBaseline | null,
	worktree: WorktreeBaseline,
): boolean {
	return baseline === worktree;
}

export function hasNoSessionWork(
	baseline: Pick<WorktreeBaseline, "initialHead" | "initialStatus">,
	current: WorktreeCurrentState,
): boolean {
	const headUnchanged = baseline.initialHead === current.currentHead;
	const baselineClean = baseline.initialStatus === EMPTY;
	const currentClean = current.currentStatus === EMPTY;
	const isUnchangedAndClean = headUnchanged && baselineClean;
	return isUnchangedAndClean && currentClean;
}
