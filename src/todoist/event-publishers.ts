import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { handleClaimError } from "../claim-error.ts";
import type { Exec } from "../shared/command.ts";
import { spawnExec } from "../shared/command.ts";
import { buildPiWorkerArgs } from "../shared/pi-worker.ts";
import {
	AUTHORIZATION_REPLACEMENT,
	CLAIM_INSTRUCTIONS,
	CLAIM_WORKER_TIMEOUT_MS,
	COMPLETION_FAILURE,
	COMPLETION_SUCCESS,
	CREATE_INSTRUCTIONS,
	ERROR_INSTRUCTIONS,
	HIGH_THINKING,
	IGNORE_PROGRESS,
	INFO,
	MATCH_TASK,
	OUTPUT_INSTRUCTIONS,
	OUTPUT_SCHEMA,
	PI_COMMAND,
	SECRET_REPLACEMENT,
	TIMED_OUT,
	TODOIST,
	TODOIST_TASK_ASSIGNED,
	UNTRUSTED_INPUT,
	WARNING,
	WORKER_ROLE,
} from "./constants.ts";
import {
	type TaskClaimWorker,
	type TaskClaimWorkerInput,
	TaskClaimWorkerResultSchema,
} from "./data.ts";
import { parseResult } from "./parsing.ts";

function workerPrompt(input: TaskClaimWorkerInput): string {
	return [
		WORKER_ROLE,
		UNTRUSTED_INPUT,
		MATCH_TASK,
		IGNORE_PROGRESS,
		CLAIM_INSTRUCTIONS,
		CREATE_INSTRUCTIONS,
		ERROR_INSTRUCTIONS,
		OUTPUT_INSTRUCTIONS,
		OUTPUT_SCHEMA,
		JSON.stringify(TaskClaimWorkerResultSchema),
		`Session ID: ${JSON.stringify(input.sessionId)}`,
		`PR reference: ${JSON.stringify(input.prRef)}`,
		`Request: ${JSON.stringify(input.prompt)}`,
		`Project: ${JSON.stringify(input.projectRef)}`,
		`Worktree: ${JSON.stringify(input.worktree)}`,
	].join("\n");
}

function sanitizeWorkerError(stderr: string): string {
	return stderr
		.replace(
			/(authorization\s*[:=]\s*bearer\s+)[^\s,;]+/gi,
			AUTHORIZATION_REPLACEMENT,
		)
		.replace(/(bearer\s+)[^\s,;]+/gi, AUTHORIZATION_REPLACEMENT)
		.replace(/(token|password|secret)\s*[:=]?\s*[^\s,;]+/gi, SECRET_REPLACEMENT)
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 300);
}

export function notifyTaskAssigned(context: ExtensionContext): void {
	context.ui.notify(TODOIST_TASK_ASSIGNED, INFO);
}

export function notifyClaimFailure(
	context: ExtensionContext,
	error: string,
): void {
	handleClaimError(context, { jobType: TODOIST, error });
}

export function notifyCompletionSuccess(context: ExtensionContext): void {
	context.ui.notify(COMPLETION_SUCCESS, INFO);
}

export function notifyCompletionFailure(context: ExtensionContext): void {
	context.ui.notify(COMPLETION_FAILURE, WARNING);
}

export function createTaskClaimWorker(exec?: Exec): TaskClaimWorker {
	const run = exec ?? spawnExec;
	return async (input) => {
		const result = await run(
			PI_COMMAND,
			buildPiWorkerArgs(workerPrompt(input), { thinking: HIGH_THINKING }),
			{ cwd: input.cwd, timeout: CLAIM_WORKER_TIMEOUT_MS },
		);
		const workerFailed = result.code !== 0;
		if (workerFailed) {
			const detail = sanitizeWorkerError(result.stderr);
			const hasTimedOut = result.killed;
			const timeout = hasTimedOut ? TIMED_OUT : "";
			const reason = detail || timeout;
			const hasReason = reason !== "";
			const reasonSuffix = hasReason ? `: ${reason}` : "";
			throw new Error(
				`claim worker exited with code ${result.code}${reasonSuffix}`,
			);
		}
		return parseResult(result.stdout, input.sessionId);
	};
}
