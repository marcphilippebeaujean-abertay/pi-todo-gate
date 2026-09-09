import { EXTENSION_CONSTANTS as C } from "../constants.ts";
import type { Exec } from "../shared/command.ts";
import type { ExitActionResult } from "../shared/exit-actions.ts";
import type { WorktreeBaseline, WorktreeCurrentState } from "./data.ts";

export function commandOutput(result: {
	stdout: string;
	code: number;
}): string | null {
	const commandSucceeded = result.code === 0;
	return commandSucceeded ? result.stdout.trim() : null;
}

export function commandFailure(result: {
	stderr: string;
	code: number;
}): string {
	const commandSucceeded = result.code === 0;
	return commandSucceeded
		? C.worktree.empty
		: result.stderr.trim().replace(/\s+/g, " ").slice(0, 200);
}

export async function currentWorktreeState(
	exec: Exec,
	cwd: string,
): Promise<WorktreeCurrentState | null> {
	try {
		const [headResult, statusResult] = await Promise.all([
			exec(C.worktree.git, [...C.worktree.headArgs], { cwd }),
			exec(C.worktree.git, [...C.worktree.statusArgs], { cwd }),
		]);
		const currentHead = commandOutput(headResult);
		const currentStatus = commandOutput(statusResult);
		const hasHead = currentHead !== null && currentHead !== C.worktree.empty;
		const hasStatus = currentStatus !== null;
		const missingState = !hasHead || !hasStatus;
		if (missingState) return null;
		return {
			currentHead: currentHead as string,
			currentStatus: currentStatus as string,
		};
	} catch {
		return null;
	}
}

export interface CleanupOptions {
	exec: Exec;
	changeDirectory: (path: string) => void;
	notify: (message: string, level?: "info" | "warning") => void;
	isCurrent: () => boolean;
}

function errorDetail(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function failureMessage(
	result: { stderr: string; code: number },
	fallback: string,
): string {
	return commandFailure(result) || fallback;
}

function cleanupFailure(
	options: CleanupOptions,
	message: string,
): ExitActionResult {
	options.notify(`${C.worktree.cleanupFailed}${message}`, C.value.warning);
	return C.exit.failed;
}

export async function cleanupWorktree(
	worktree: WorktreeBaseline,
	force: boolean,
	options: CleanupOptions,
): Promise<ExitActionResult> {
	const isCurrent = options.isCurrent();
	if (!isCurrent) return C.exit.failed;
	try {
		options.changeDirectory(worktree.mainRoot);
	} catch (error) {
		return cleanupFailure(options, errorDetail(error));
	}
	const removeArgs: string[] = [...C.worktree.removeArgs];
	const shouldForce = force;
	if (shouldForce) removeArgs.push(C.worktree.forceArg);
	removeArgs.push(worktree.worktreePath);
	const removeResult = await options.exec(C.worktree.git, removeArgs, {
		cwd: worktree.mainRoot,
	});
	const isCurrentAfterRemove = options.isCurrent();
	if (!isCurrentAfterRemove) return C.exit.failed;
	const removeFailed = removeResult.code !== 0;
	if (removeFailed)
		return cleanupFailure(
			options,
			failureMessage(removeResult, C.worktree.removalFailed),
		);

	const branchResult = await options.exec(
		C.worktree.git,
		[...C.worktree.branchArgs, worktree.branch],
		{ cwd: worktree.mainRoot },
	);
	const isCurrentAfterBranch = options.isCurrent();
	if (!isCurrentAfterBranch) return C.exit.failed;
	const branchFailed = branchResult.code !== 0;
	if (branchFailed) {
		options.notify(
			`${C.worktree.removedBranchFailed}${failureMessage(branchResult, C.worktree.branchFailed)}`,
			C.value.warning,
		);
		return C.exit.failed;
	}
	return C.exit.completed;
}
