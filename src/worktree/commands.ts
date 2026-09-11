import type { Exec } from "../shared/command.ts";
import type { ExitActionResult } from "../shared/exit-actions.ts";
import {
	BRANCH_ARGS,
	BRANCH_FAILED,
	CLEANUP_FAILED,
	COMPLETED,
	EMPTY,
	FAILED,
	FORCE_ARG,
	GIT,
	HEAD_ARGS,
	REMOVAL_FAILED,
	REMOVE_ARGS,
	REMOVED_BRANCH_FAILED,
	STATUS_ARGS,
	WARNING,
} from "./constants.ts";
import type {
	CleanupOptions,
	WorktreeBaseline,
	WorktreeCurrentState,
} from "./data.ts";

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
		? EMPTY
		: result.stderr.trim().replace(/\s+/g, " ").slice(0, 200);
}

export async function currentWorktreeState(
	exec: Exec,
	cwd: string,
): Promise<WorktreeCurrentState | null> {
	try {
		const [headResult, statusResult] = await Promise.all([
			exec(GIT, [...HEAD_ARGS], { cwd }),
			exec(GIT, [...STATUS_ARGS], { cwd }),
		]);
		const currentHead = commandOutput(headResult);
		const currentStatus = commandOutput(statusResult);
		const hasHead = currentHead !== null && currentHead !== EMPTY;
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
	options.notify(`${CLEANUP_FAILED}${message}`, WARNING);
	return FAILED;
}

export async function cleanupWorktree(
	worktree: WorktreeBaseline,
	force: boolean,
	options: CleanupOptions,
): Promise<ExitActionResult> {
	const isCurrent = options.isCurrent();
	if (!isCurrent) return FAILED;
	try {
		options.changeDirectory(worktree.mainRoot);
	} catch (error) {
		return cleanupFailure(options, errorDetail(error));
	}
	const removeArgs: string[] = [...REMOVE_ARGS];
	const shouldForce = force;
	if (shouldForce) removeArgs.push(FORCE_ARG);
	removeArgs.push(worktree.worktreePath);
	const removeResult = await options.exec(GIT, removeArgs, {
		cwd: worktree.mainRoot,
	});
	const isCurrentAfterRemove = options.isCurrent();
	if (!isCurrentAfterRemove) return FAILED;
	const removeFailed = removeResult.code !== 0;
	if (removeFailed)
		return cleanupFailure(
			options,
			failureMessage(removeResult, REMOVAL_FAILED),
		);

	const worktreeRemoved = options.worktreeRemoved;
	if (worktreeRemoved !== undefined) worktreeRemoved.value = true;
	const branchResult = await options.exec(
		GIT,
		[...BRANCH_ARGS, worktree.branch],
		{ cwd: worktree.mainRoot },
	);
	const isCurrentAfterBranch = options.isCurrent();
	if (!isCurrentAfterBranch) return FAILED;
	const branchFailed = branchResult.code !== 0;
	if (branchFailed) {
		options.notify(
			`${REMOVED_BRANCH_FAILED}${failureMessage(branchResult, BRANCH_FAILED)}`,
			WARNING,
		);
		return FAILED;
	}
	return COMPLETED;
}

export function isCurrentWorktree(
	baseline: WorktreeBaseline | null,
	worktree: WorktreeBaseline,
): boolean {
	return baseline === worktree;
}
