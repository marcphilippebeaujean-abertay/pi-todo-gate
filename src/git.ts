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

const GIT = "git";
const STATUS = "status";
const PORCELAIN = "--porcelain=v1";
const UNTRACKED_FILES = "--untracked-files=all";

export interface WorktreeInfo {
	isWorktree: boolean;
	root: string | null;
	branch: string | null;
}

export async function hasUncommittedChanges(
	exec: Exec,
	cwd: string,
): Promise<boolean | null> {
	try {
		const result = await exec(GIT, [STATUS, PORCELAIN, UNTRACKED_FILES], {
			cwd,
		});
		const commandFailed = result.code !== 0;
		if (commandFailed) return null;
		return result.stdout.trim() !== "";
	} catch {
		return null;
	}
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
export { isGithubPrAvailable } from "./pr/git.ts";
export { matchesPinnedPr } from "./shared/merge-matching.ts";
