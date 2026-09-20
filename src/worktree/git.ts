import type { CommandResult, Exec } from "../shared/command.ts";
import type { ExitActionResult } from "../shared/exit-actions.ts";
import { runSessionAction } from "../shared/session-actions.ts";
import {
	BRANCH_ARGS,
	BRANCH_FAILED,
	BRANCH_SKIPPED_SESSION_CHANGE,
	CLEANUP_FAILED,
	CLEANUP_FINISHED_SESSION_CHANGE,
	CLEANUP_SKIPPED_SESSION_CHANGE,
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
	WorktreeCleanupTarget,
	WorktreeCurrentState,
} from "./internal-state.ts";

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

function runCleanupMutation<T>(
	options: CleanupOptions,
	action: () => Promise<T> | T,
	notification: string,
): ReturnType<typeof runSessionAction<T>> {
	return runSessionAction(
		options.isCurrent,
		action,
		options.notifySession.bind(null, notification),
	);
}

async function removeWorktreeNow(
	worktree: WorktreeCleanupTarget,
	removeArgs: string[],
	options: CleanupOptions,
): Promise<CommandResult | null> {
	const removal = await runCleanupMutation(
		options,
		() =>
			options.exec(GIT, removeArgs, {
				cwd: worktree.mainRoot,
			}),
		CLEANUP_SKIPPED_SESSION_CHANGE,
	);
	const wasSkipped = !removal.started;
	if (wasSkipped) return null;
	const sessionChanged = !removal.currentAfterAction;
	if (sessionChanged) {
		await options.notifySession(CLEANUP_FINISHED_SESSION_CHANGE);
		return null;
	}
	return removal.value;
}

async function deleteBranchNow(
	worktree: WorktreeCleanupTarget,
	options: CleanupOptions,
): Promise<CommandResult | null> {
	const branchDeletion = await runCleanupMutation(
		options,
		() =>
			options.exec(GIT, [...BRANCH_ARGS, worktree.branch], {
				cwd: worktree.mainRoot,
			}),
		BRANCH_SKIPPED_SESSION_CHANGE,
	);
	const wasSkipped = !branchDeletion.started;
	if (wasSkipped) return null;
	const sessionChanged = !branchDeletion.currentAfterAction;
	if (sessionChanged) {
		await options.notifySession(BRANCH_SKIPPED_SESSION_CHANGE);
		return null;
	}
	return branchDeletion.value;
}

export async function cleanupWorktree(
	worktree: WorktreeCleanupTarget,
	force: boolean,
	options: CleanupOptions,
): Promise<ExitActionResult> {
	try {
		const directoryChange = await runCleanupMutation(
			options,
			() => options.changeDirectory(worktree.mainRoot),
			CLEANUP_SKIPPED_SESSION_CHANGE,
		);
		const wasDirectoryChangeSkipped = !directoryChange.started;
		if (wasDirectoryChangeSkipped) return FAILED;
	} catch (error) {
		return cleanupFailure(options, errorDetail(error));
	}
	const removeArgs: string[] = [...REMOVE_ARGS];
	const shouldForce = force;
	if (shouldForce) removeArgs.push(FORCE_ARG);
	removeArgs.push(worktree.worktreePath);
	const removeResult = await removeWorktreeNow(worktree, removeArgs, options);
	const hasNoRemoveResult = removeResult === null;
	if (hasNoRemoveResult) return FAILED;
	const removeFailed = removeResult.code !== 0;
	if (removeFailed)
		return cleanupFailure(
			options,
			failureMessage(removeResult, REMOVAL_FAILED),
		);

	const worktreeRemoved = options.worktreeRemoved;
	if (worktreeRemoved !== undefined) worktreeRemoved.value = true;
	const branchResult = await deleteBranchNow(worktree, options);
	const hasNoBranchResult = branchResult === null;
	if (hasNoBranchResult) return FAILED;
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
	current: WorktreeCleanupTarget | null,
	worktree: WorktreeCleanupTarget,
): boolean {
	if (current === null) return false;
	const hasSameWorktreePath = current.worktreePath === worktree.worktreePath;
	const hasSameBranch = current.branch === worktree.branch;
	const hasSameMainRoot = current.mainRoot === worktree.mainRoot;
	return [hasSameWorktreePath, hasSameBranch, hasSameMainRoot].every(Boolean);
}
