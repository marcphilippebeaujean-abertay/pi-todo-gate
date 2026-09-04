import { spawn } from "node:child_process";
import {
	appendBounded,
	type ClaimWorkerResult,
	parseClaimResult,
} from "../herdr-claim-worker-result.ts";
import { withWorkerMarker } from "../session.ts";
import { buildPiWorkerArgs } from "../shared/pi-worker.ts";

export interface ClaimWorkerRequest {
	prompt: string;
	instructions: string;
	onClaimComplete: (result?: ClaimWorkerResult) => void;
	onFailure: (message: string) => void;
}

export interface ClaimWorkerHandle {
	cancel(): void;
}

export interface ClaimWorkerOptions {
	command?: string;
	cwd?: string;
	spawnWorker?: WorkerSpawner;
}

export type WorkerSpawner = (
	command: string,
	args: readonly string[],
	options: {
		cwd: string;
		env: NodeJS.ProcessEnv;
		shell: false;
		stdio: ["ignore", "pipe", "pipe"];
	},
) => WorkerProcess;

export interface WorkerOutputStream {
	on(event: "data", listener: (chunk: Buffer | string) => void): void;
}

export interface WorkerProcess {
	stdout: WorkerOutputStream;
	stderr: WorkerOutputStream;
	on(event: "close" | "error", listener: (...args: unknown[]) => void): void;
	kill(signal?: NodeJS.Signals): boolean;
}

const DEFAULT_COMMAND = "pi";
const MISSING_CLAIM_EVIDENCE =
	"Herdr claim worker completed without claim evidence.";
const STDIO_IGNORE = "ignore";
const STDIO_PIPE = "pipe";
const DATA_EVENT = "data";
const ERROR_EVENT = "error";
const CLOSE_EVENT = "close";
const UNKNOWN_ERROR = "unknown error";
const SIGTERM = "SIGTERM";

const defaultSpawnWorker: WorkerSpawner = (command, args, options) =>
	spawn(command, [...args], {
		cwd: options.cwd,
		env: options.env,
		shell: options.shell,
		stdio: options.stdio,
	}) as unknown as WorkerProcess;

function spawnWorkerProcess(
	request: ClaimWorkerRequest,
	options: ClaimWorkerOptions,
): WorkerProcess {
	const spawnWorker = options.spawnWorker ?? defaultSpawnWorker;
	return spawnWorker(
		options.command ?? DEFAULT_COMMAND,
		buildPiWorkerArgs(request.prompt, { instructions: request.instructions }),
		{
			cwd: options.cwd ?? process.cwd(),
			env: withWorkerMarker(),
			shell: false,
			stdio: [STDIO_IGNORE, STDIO_PIPE, STDIO_PIPE],
		},
	);
}

interface WorkerState {
	settled: boolean;
	cancelled: boolean;
	stdout: string;
	stderr: string;
}

function registerWorkerLifecycle(
	child: WorkerProcess,
	request: ClaimWorkerRequest,
	state: WorkerState,
): void {
	child.stdout.on(DATA_EVENT, (chunk) => {
		// Worker output is intentionally private and never forwarded to the parent session.
		state.stdout = appendBounded(state.stdout, chunk);
	});
	child.stderr.on(DATA_EVENT, (chunk) => {
		state.stderr = appendBounded(state.stderr, chunk);
	});

	const fail = (message: string): void => {
		const isFinished = state.settled || state.cancelled;
		if (isFinished) return;
		state.settled = true;
		request.onFailure(message);
	};

	child.on(ERROR_EVENT, (...args) => {
		const error = args[0];
		const detail =
			error instanceof Error ? error.message : String(error ?? UNKNOWN_ERROR);
		fail(`Herdr claim worker failed: ${detail}`);
	});
	child.on(CLOSE_EVENT, (...args) => {
		const isFinished = state.settled || state.cancelled;
		if (isFinished) return;
		const code = args[0];
		state.settled = true;
		const didSucceed = code === 0;
		if (didSucceed) {
			const result = parseClaimResult(state.stdout);
			const hasNoClaimResult = result === undefined;
			if (hasNoClaimResult) {
				request.onFailure(MISSING_CLAIM_EVIDENCE);
				return;
			}
			request.onClaimComplete(result);
			return;
		}
		const detail = state.stderr.trim();
		const hasDetail = detail !== "";
		const detailSuffix = hasDetail ? `: ${detail}` : "";
		request.onFailure(
			`Herdr claim worker exited with code ${String(code ?? UNKNOWN_ERROR)}${detailSuffix}`,
		);
	});
}

export function startClaimWorker(
	request: ClaimWorkerRequest,
	options: ClaimWorkerOptions = {},
): ClaimWorkerHandle {
	const child = spawnWorkerProcess(request, options);
	const state: WorkerState = {
		settled: false,
		cancelled: false,
		stdout: "",
		stderr: "",
	};
	registerWorkerLifecycle(child, request, state);

	return {
		cancel(): void {
			const isFinished = state.settled || state.cancelled;
			if (isFinished) return;
			state.cancelled = true;
			child.kill(SIGTERM);
		},
	};
}
