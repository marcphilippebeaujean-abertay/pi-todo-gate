export { spawnExec } from "./command-exec.ts";
export {
	ghMergeTargets,
	mergeCommand,
	positionalArgs,
} from "./git-merge.ts";

export interface CommandResult {
	stdout: string;
	stderr: string;
	code: number;
	killed?: boolean;
}

export type Exec = (
	command: string,
	args: string[],
	options?: { timeout?: number; signal?: AbortSignal; cwd?: string },
) => Promise<CommandResult>;

export interface WorktreeInfo {
	isWorktree: boolean;
	root: string | null;
	branch: string | null;
}

export interface OpenPrInfo {
	url: string | null;
	state: "OPEN" | "CLOSED" | "MERGED" | "UNKNOWN";
}
export { findOpenPr } from "./git-pr.ts";
export {
	inspectWorktree,
	isLinkedWorktreePaths,
	parseBranchName,
} from "./git-worktree.ts";
export { matchesPinnedPr } from "./shared/merge-matching.ts";
