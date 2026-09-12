import type {
	PiWorkerHandle,
	PiWorkerProcess,
	PiWorkerRequest,
} from "./pi-worker-data.ts";

const WORKER_OUTPUT_LIMIT = 500_000;
const UNKNOWN_ERROR = "unknown error";
const SIGTERM = "SIGTERM";
const DATA_EVENT = "data";
const ERROR_EVENT = "error";
const CLOSE_EVENT = "close";
const EXPECTED_RESULT_ERROR = "completed without expected result";

function appendWorkerOutput(current: string, chunk: Buffer | string): string {
	const next = current + String(chunk);
	const exceedsLimit = next.length > WORKER_OUTPUT_LIMIT;
	return exceedsLimit ? next.slice(next.length - WORKER_OUTPUT_LIMIT) : next;
}

function handleWorkerClose<TResult>(
	args: unknown[],
	request: PiWorkerRequest<TResult>,
	stdout: string,
	stderr: string,
): void {
	const code = args[0];
	const workerSucceeded = code === 0;
	if (workerSucceeded) {
		const result = request.parseResult(stdout);
		const hasResult = result !== undefined;
		if (hasResult) request.onResult(result);
		else {
			console.error(EXPECTED_RESULT_ERROR);
			request.onFailure(EXPECTED_RESULT_ERROR);
		}
		return;
	}
	const detail = stderr.trim();
	const hasDetail = detail !== "";
	const suffix = hasDetail ? `: ${detail}` : "";
	request.onFailure(
		`worker exited with code ${String(code ?? UNKNOWN_ERROR)}${suffix}`,
	);
}

export function monitorPiWorker<TResult>(
	child: PiWorkerProcess,
	request: PiWorkerRequest<TResult>,
): PiWorkerHandle {
	let settled = false;
	let cancelled = false;
	let stdout = "";
	let stderr = "";
	const isFinished = (): boolean => settled || cancelled;
	const fail = (message: string): void => {
		const workerFinished = isFinished();
		if (workerFinished) return;
		settled = true;
		request.onFailure(message);
	};
	child.stdout.on(DATA_EVENT, (chunk) => {
		stdout = appendWorkerOutput(stdout, chunk);
	});
	child.stderr.on(DATA_EVENT, (chunk) => {
		stderr = appendWorkerOutput(stderr, chunk);
	});
	child.on(ERROR_EVENT, (...args) => {
		const error = args[0];
		const detail =
			error instanceof Error ? error.message : String(error ?? UNKNOWN_ERROR);
		fail(`worker failed: ${detail}`);
	});
	child.on(CLOSE_EVENT, (...args) => {
		const workerFinished = isFinished();
		if (workerFinished) return;
		settled = true;
		handleWorkerClose(args, request, stdout, stderr);
	});
	return {
		cancel(): void {
			const workerFinished = isFinished();
			if (workerFinished) return;
			cancelled = true;
			child.kill(SIGTERM);
		},
	};
}
