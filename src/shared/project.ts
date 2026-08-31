import { resolve } from "node:path";
import type { CommandResult, Exec } from "./command.ts";

export interface ProjectInfo {
	isWorktree: boolean;
	root: string | null;
	branch: string | null;
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
	return gitDir !== null && commonDir !== null && gitDir !== commonDir;
}

function firstWorktreePath(output: string): string | null {
	const line = output
		.split(/\r?\n/)
		.find((value) => value.startsWith("worktree "));
	return line ? line.slice("worktree ".length).trim() : null;
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
			exec("git", ["rev-parse", "--show-toplevel"], { cwd }),
			exec("git", ["branch", "--show-current"], { cwd }),
			exec("git", ["worktree", "list", "--porcelain"], { cwd }),
		]);
	} catch {
		return { isWorktree: false, root: null, branch: null };
	}
	const root =
		rootResult.code === 0 ? resolveGitPath(cwd, rootResult.stdout) : null;
	const branch =
		branchResult.code === 0 ? parseBranchName(branchResult.stdout) : null;
	const mainRoot =
		listResult.code === 0
			? resolveGitPath(cwd, firstWorktreePath(listResult.stdout) ?? "")
			: null;
	return {
		isWorktree:
			root !== null && mainRoot !== null && root !== resolve(mainRoot),
		root,
		branch,
	};
}
