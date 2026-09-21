import type { CommandResult, Exec } from "../shared/command.ts";
import { EXTENSION_CONSTANTS as C } from "../shared/constants.ts";
import type { ExitActionResult } from "../shared/exit-actions.ts";
import type { SessionState } from "../state.ts";
import {
	BRANCH_ARGS,
	BRANCH_FAILED,
	CLEANUP_FAILED,
	COMPLETED,
	EMPTY,
	FAILED,
	FORCE_ARG,
	GIT,
	REMOVAL_FAILED,
	REMOVE_ARGS,
	REMOVED_BRANCH_FAILED,
	STATUS_ARGS,
	WARNING,
} from "./constants.ts";
import type { CleanupOptions } from "./internal-state.ts";

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

export async function currentWorktreeStatus(
	exec: Exec,
	cwd: string,
): Promise<string | null> {
	try {
		const result = await exec(GIT, [...STATUS_ARGS], { cwd });
		return commandOutput(result);
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

function worktreeState(state: SessionState["gitState"]):
	| (SessionState["gitState"] & {
			isWorktree: true;
			branch: string;
			mainRoot: string;
			worktreeRoot: string;
	  })
	| null {
	const isWorktree = state.isWorktree === true;
	if (!isWorktree) return null;
	const hasBranch = typeof state.branch === "string";
	if (!hasBranch) return null;
	const hasMainRoot = typeof state.mainRoot === "string";
	if (!hasMainRoot) return null;
	const hasWorktreeRoot = typeof state.worktreeRoot === "string";
	if (!hasWorktreeRoot) return null;
	return state as SessionState["gitState"] & {
		isWorktree: true;
		branch: string;
		mainRoot: string;
		worktreeRoot: string;
	};
}

function cleanupFailure(
	options: CleanupOptions,
	message: string,
): ExitActionResult {
	options.notify(`${CLEANUP_FAILED}${message}`, WARNING);
	return FAILED;
}

async function removeWorktreeNow(
	mainRoot: string,
	removeArgs: string[],
	options: CleanupOptions,
): Promise<CommandResult> {
	return options.exec(GIT, removeArgs, { cwd: mainRoot });
}

async function deleteBranchNow(
	branch: string,
	mainRoot: string,
	options: CleanupOptions,
): Promise<CommandResult> {
	return options.exec(GIT, [...BRANCH_ARGS, branch], { cwd: mainRoot });
}

export async function cleanupWorktree(
	sessionState: SessionState,
	force: boolean,
	options: CleanupOptions,
): Promise<ExitActionResult> {
	const worktree = worktreeState(sessionState.gitState);
	if (worktree === null) return FAILED;
	const { branch, mainRoot, worktreeRoot } = worktree;
	const status = await currentWorktreeStatus(options.exec, worktreeRoot);
	if (status === null) {
		options.notify(C.worktree.statusUnavailable, "warning");
		return FAILED;
	}
	const hasChanges = status !== EMPTY;
	const shouldRejectDirtyCleanup = hasChanges && !force;
	if (shouldRejectDirtyCleanup) return FAILED;
	try {
		options.changeDirectory(mainRoot);
	} catch (error) {
		return cleanupFailure(options, errorDetail(error));
	}
	const removeArgs: string[] = [...REMOVE_ARGS];
	const shouldForceRemoval = force;
	if (shouldForceRemoval) removeArgs.push(FORCE_ARG);
	removeArgs.push(worktreeRoot);
	const removeResult = await removeWorktreeNow(mainRoot, removeArgs, options);
	const removeFailed = removeResult.code !== 0;
	if (removeFailed)
		return cleanupFailure(
			options,
			failureMessage(removeResult, REMOVAL_FAILED),
		);

	const worktreeRemoved = options.worktreeRemoved;
	if (worktreeRemoved !== undefined) worktreeRemoved.value = true;
	const branchResult = await deleteBranchNow(branch, mainRoot, options);
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
