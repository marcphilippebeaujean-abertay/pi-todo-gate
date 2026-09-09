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

export function isCurrentWorktree(
	baseline: WorktreeBaseline | null,
	worktree: WorktreeBaseline,
	generation: number,
	currentGeneration: number,
): boolean {
	const sameGeneration = generation === currentGeneration;
	const sameBaseline = baseline === worktree;
	return sameGeneration && sameBaseline;
}

export function hasNoSessionWork(
	baseline: Pick<WorktreeBaseline, "initialHead" | "initialStatus">,
	current: WorktreeCurrentState,
): boolean {
	const headUnchanged = baseline.initialHead === current.currentHead;
	const baselineClean = baseline.initialStatus === C.worktree.empty;
	const currentClean = current.currentStatus === C.worktree.empty;
	const bothClean = baselineClean && currentClean;
	return headUnchanged && bothClean;
}
