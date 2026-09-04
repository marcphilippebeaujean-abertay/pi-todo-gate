const WORKTREE_PREFIX = "worktree ";
const GIT_COMMAND = "git";

import { resolve } from "node:path";
import type { CommandResult, Exec } from "./command.ts";

export interface ProjectInfo {
	isWorktree: boolean;
	root: string | null;
	branch: string | null;
	mainRoot: string | null;
}

export function resolveGitPath(cwd: string, output: string): string | null {
	const value = output.trim();
	const hasValue = value !== "";
	return hasValue ? resolve(cwd, value) : null;
}

export function parseBranchName(output: string): string | null {
	const value = output.trim();
	return value || null;
}

export function isLinkedWorktreePaths(
	cwd: string,
	gitDirOutput: string,
	commonDirOutput: string,
): boolean {
	const gitDir = resolveGitPath(cwd, gitDirOutput);
	const commonDir = resolveGitPath(cwd, commonDirOutput);
	if (gitDir === null) return false;
	if (commonDir === null) return false;
	return gitDir !== commonDir;
}

function firstWorktreePath(output: string): string | null {
	const line = output
		.split(/\r?\n/)
		.find((value) => value.startsWith(WORKTREE_PREFIX));
	const hasLine = line !== undefined;
	return hasLine ? line.slice(WORKTREE_PREFIX.length).trim() : null;
}

function successfulResult<T>(result: CommandResult, value: T): T | null {
	const commandSucceeded = result.code === 0;
	return commandSucceeded ? value : null;
}

function projectInfo(
	root: string | null,
	branch: string | null,
	mainRoot: string | null,
): ProjectInfo {
	const hasRoot = root !== null;
	const hasMainRoot = mainRoot !== null;
	const missingPath = !hasRoot || !hasMainRoot;
	if (missingPath) return { isWorktree: false, root, branch, mainRoot };
	return { isWorktree: root !== resolve(mainRoot), root, branch, mainRoot };
}

export async function inspectProject(
	exec: Exec,
	cwd: string,
): Promise<ProjectInfo> {
	let rootResult: CommandResult;
	let branchResult: CommandResult;
	let listResult: CommandResult;
	try {
		[rootResult, branchResult, listResult] = await Promise.all([
			exec(GIT_COMMAND, ["rev-parse", "--show-toplevel"], { cwd }),
			exec(GIT_COMMAND, ["branch", "--show-current"], { cwd }),
			exec(GIT_COMMAND, ["worktree", "list", "--porcelain"], { cwd }),
		]);
	} catch {
		return {
			isWorktree: false,
			root: null,
			branch: null,
			mainRoot: null,
		};
	}
	const root = successfulResult(
		rootResult,
		resolveGitPath(cwd, rootResult.stdout),
	);
	const branch = successfulResult(
		branchResult,
		parseBranchName(branchResult.stdout),
	);
	const firstPath = firstWorktreePath(listResult.stdout) ?? "";
	const mainRoot = successfulResult(listResult, resolveGitPath(cwd, firstPath));
	return projectInfo(root, branch, mainRoot);
}
