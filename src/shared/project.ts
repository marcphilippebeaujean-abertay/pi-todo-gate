const STRING_LITERAL_WORKTREE_05CE539E = "worktree ";
const STRING_LITERAL_GIT_12CD0102 = "git";
const STRING_LITERAL_REV_PARSE_37D9BB4A = "rev-parse";
const STRING_LITERAL_SHOW_TOPLEVEL_D0D6C236 = "--show-toplevel";
const STRING_LITERAL_BRANCH_06286632 = "branch";
const STRING_LITERAL_SHOW_CURRENT_E67F08AC = "--show-current";
const STRING_LITERAL_WORKTREE_09F58E59 = "worktree";
const STRING_LITERAL_LIST_5D101AA9 = "list";
const STRING_LITERAL_PORCELAIN_BB6738A9 = "--porcelain";

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
	return value ? resolve(cwd, value) : null;
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
		.find((value) => value.startsWith(STRING_LITERAL_WORKTREE_05CE539E));
	return line
		? line.slice(STRING_LITERAL_WORKTREE_05CE539E.length).trim()
		: null;
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
			exec(
				STRING_LITERAL_GIT_12CD0102,
				[
					STRING_LITERAL_REV_PARSE_37D9BB4A,
					STRING_LITERAL_SHOW_TOPLEVEL_D0D6C236,
				],
				{ cwd },
			),
			exec(
				STRING_LITERAL_GIT_12CD0102,
				[STRING_LITERAL_BRANCH_06286632, STRING_LITERAL_SHOW_CURRENT_E67F08AC],
				{ cwd },
			),
			exec(
				STRING_LITERAL_GIT_12CD0102,
				[
					STRING_LITERAL_WORKTREE_09F58E59,
					STRING_LITERAL_LIST_5D101AA9,
					STRING_LITERAL_PORCELAIN_BB6738A9,
				],
				{ cwd },
			),
		]);
	} catch {
		return {
			isWorktree: false,
			root: null,
			branch: null,
			mainRoot: null,
		};
	}
	const root =
		rootResult.code === 0 ? resolveGitPath(cwd, rootResult.stdout) : null;
	const branch =
		branchResult.code === 0 ? parseBranchName(branchResult.stdout) : null;
	const mainRoot =
		listResult.code === 0
			? resolveGitPath(cwd, firstWorktreePath(listResult.stdout) ?? "")
			: null;
	return projectInfo(root, branch, mainRoot);
}
