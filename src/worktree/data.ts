import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { EXTENSION_CONSTANTS as C } from "../constants.ts";

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

export interface WorktreeModule {
	sessionStart(ctx: ExtensionContext): Promise<void>;
	deactivate(): void;
}

export function isCurrentWorktree(
	baseline: WorktreeBaseline | null,
	worktree: WorktreeBaseline,
	generation: number,
	currentGeneration: number,
): boolean {
	return generation === currentGeneration && baseline === worktree;
}

export function hasNoSessionWork(
	baseline: Pick<WorktreeBaseline, "initialHead" | "initialStatus">,
	current: WorktreeCurrentState,
): boolean {
	const headUnchanged = baseline.initialHead === current.currentHead;
	const baselineClean = baseline.initialStatus === C.worktree.empty;
	const currentClean = current.currentStatus === C.worktree.empty;
	const isUnchangedAndClean = headUnchanged && baselineClean;
	return isUnchangedAndClean && currentClean;
}
