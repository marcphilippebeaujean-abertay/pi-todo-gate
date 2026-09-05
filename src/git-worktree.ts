import { resolve } from "node:path";
import type { CommandResult, Exec, WorktreeInfo } from "./git.ts";

const GIT = "git";
const REV_PARSE = "rev-parse";
const SHOW_TOPLEVEL = "--show-toplevel";
const BRANCH = "branch";
const SHOW_CURRENT = "--show-current";
const WORKTREE_COMMAND = "worktree";
const LIST = "list";
const PORCELAIN = "--porcelain";
const WORKTREE = "worktree ";

export function parseBranchName(output: string): string | null {
	const value = output.trim();
	return value || null;
}

export function isLinkedWorktreePaths(
	cwd: string,
	gitDirOutput: string,
	commonDirOutput: string,
): boolean {
	const gitDirValue = gitDirOutput.trim();
	const commonDirValue = commonDirOutput.trim();
	const hasPaths = gitDirValue !== "" && commonDirValue !== "";
	if (!hasPaths) return false;
	return resolve(cwd, gitDirValue) !== resolve(cwd, commonDirValue);
}

function firstWorktreePath(output: string): string | null {
	const line = output
		.split(/\r?\n/)
		.find((value) => value.startsWith(WORKTREE));
	const hasLine = line !== undefined;
	return hasLine ? line.slice(WORKTREE.length).trim() : null;
}

function successfulPath(result: CommandResult): string | null {
	const commandSucceeded = result.code === 0;
	const output = result.stdout.trim();
	const hasOutput = output !== "";
	const hasSuccessfulOutput = commandSucceeded && hasOutput;
	if (!hasSuccessfulOutput) return null;
	return output;
}

export async function inspectWorktree(
	exec: Exec,
	cwd: string,
): Promise<WorktreeInfo> {
	const [rootResult, branchResult, listResult] = await Promise.all([
		exec(GIT, [REV_PARSE, SHOW_TOPLEVEL], {
			cwd,
		}),
		exec(GIT, [BRANCH, SHOW_CURRENT], {
			cwd,
		}),
		exec(GIT, [WORKTREE_COMMAND, LIST, PORCELAIN], { cwd }),
	]);
	const rootValue = successfulPath(rootResult);
	const hasRoot = rootValue !== null;
	const root = hasRoot ? resolve(rootValue) : null;
	const branch = successfulPath(branchResult);
	const mainRoot = firstWorktreePath(listResult.stdout);
	const hasDistinctRoots = root !== null && mainRoot !== null;
	let isWorktree = false;
	if (hasDistinctRoots) isWorktree = root !== resolve(mainRoot);
	return { isWorktree, root, branch };
}
