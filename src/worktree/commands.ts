import { EXTENSION_CONSTANTS as C } from "../constants.ts";
import type { Exec } from "../shared/command.ts";

export interface WorktreeCurrentState {
	currentHead: string;
	currentStatus: string;
}

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
