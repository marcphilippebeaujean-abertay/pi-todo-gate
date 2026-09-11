import type { WorktreeBaseline } from "./module.ts";

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
