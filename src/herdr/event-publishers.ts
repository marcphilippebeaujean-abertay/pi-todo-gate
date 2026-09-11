import { startPiWorker } from "../shared/pi-worker-runtime.ts";
import { parseClaimResult } from "./claim-worker-result.ts";
import {
	CLAIM_COMPLETED_EVENT,
	CLAIM_FAILED_EVENT,
	EXPECTED_RESULT_FAILURE,
	HERDR_CLAIM_FAILURE_PREFIX,
	MISSING_CLAIM_EVIDENCE,
} from "./constants.ts";

import type {
	ClaimWorkerHandle,
	ClaimWorkerOptions,
	ClaimWorkerRequest,
	StartBackgroundWorker,
	WorkerSpawner,
} from "./state.ts";

function claimFailureMessage(message: string): string {
	const isMissingExpectedResult = message === EXPECTED_RESULT_FAILURE;
	return isMissingExpectedResult
		? MISSING_CLAIM_EVIDENCE
		: `${HERDR_CLAIM_FAILURE_PREFIX}${message}`;
}

export function startClaimWorker(
	request: ClaimWorkerRequest,
	options?: ClaimWorkerOptions,
): ClaimWorkerHandle {
	const resolvedOptions = options ?? {};
	return startPiWorker(
		{
			prompt: request.prompt,
			instructions: request.instructions,
			parseResult: parseClaimResult,
			onResult: (result) =>
				request.events.emit(CLAIM_COMPLETED_EVENT, {
					attemptId: request.attemptId,
					result,
				}),
			onFailure: (message) =>
				request.events.emit(CLAIM_FAILED_EVENT, {
					attemptId: request.attemptId,
					message: claimFailureMessage(message),
					workerFailed: true,
				}),
		},
		{
			command: resolvedOptions.command,
			cwd: resolvedOptions.cwd,
			spawnWorker: resolvedOptions.spawnWorker,
		},
	);
}

export function defaultStartWorker(
	cwd: string,
	spawnWorker: WorkerSpawner | undefined,
	request: ClaimWorkerRequest,
): ReturnType<StartBackgroundWorker> {
	return startClaimWorker(request, { cwd, spawnWorker });
}
