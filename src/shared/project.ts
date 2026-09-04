const WORKTREE_PREFIX = "worktree ";
const GIT_COMMAND = "git";
const REV_PARSE_COMMAND = "rev-parse";
const SHOW_TOPLEVEL_FLAG = "--show-toplevel";
const BRANCH_COMMAND = "branch";
const SHOW_CURRENT_FLAG = "--show-current";
const WORKTREE_COMMAND = "worktree";
const LIST_COMMAND = "list";
const PORCELAIN_FLAG = "--porcelain";
const ROOT_COMMAND_ARGS = [REV_PARSE_COMMAND, SHOW_TOPLEVEL_FLAG];
const BRANCH_COMMAND_ARGS = [BRANCH_COMMAND, SHOW_CURRENT_FLAG];
const WORKTREE_COMMAND_ARGS = [WORKTREE_COMMAND, LIST_COMMAND, PORCELAIN_FLAG];

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
			exec(GIT_COMMAND, ROOT_COMMAND_ARGS, { cwd }),
			exec(GIT_COMMAND, BRANCH_COMMAND_ARGS, { cwd }),
			exec(GIT_COMMAND, WORKTREE_COMMAND_ARGS, { cwd }),
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
