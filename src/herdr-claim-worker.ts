import { spawn } from "node:child_process";

export interface ClaimWorkerRequest {
	prompt: string;
	instructions: string;
	onClaimComplete: () => void;
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
const MAX_DIAGNOSTIC_BYTES = 500;
const MODE_FLAG = "--mode";
const JSON_MODE = "json";
const PROMPT_FLAG = "-p";
const NO_SESSION_FLAG = "--no-session";
const NO_EXTENSIONS_FLAG = "--no-extensions";
const STDIO_IGNORE = "ignore";
const STDIO_PIPE = "pipe";
const DATA_EVENT = "data";
const ERROR_EVENT = "error";
const CLOSE_EVENT = "close";
const CHILD_PROCESS_VALUE = "1";
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
		[
			MODE_FLAG,
			JSON_MODE,
			PROMPT_FLAG,
			NO_SESSION_FLAG,
			NO_EXTENSIONS_FLAG,
			`${request.instructions}\n\nParent user prompt:\n${request.prompt}`,
		],
		{
			cwd: options.cwd ?? process.cwd(),
			env: { ...process.env, PI_SUBAGENT_CHILD: CHILD_PROCESS_VALUE },
			shell: false,
			stdio: [STDIO_IGNORE, STDIO_PIPE, STDIO_PIPE],
		},
	);
}

interface WorkerState {
	settled: boolean;
	cancelled: boolean;
	stderr: string;
}

function registerWorkerLifecycle(
	child: WorkerProcess,
	request: ClaimWorkerRequest,
	state: WorkerState,
): void {
	child.stdout.on(DATA_EVENT, () => {
		// Worker output is intentionally private and never forwarded to the parent session.
	});
	child.stderr.on(DATA_EVENT, (chunk) => {
		const next = `${state.stderr}${chunk.toString()}`;
		state.stderr =
			next.length > MAX_DIAGNOSTIC_BYTES
				? next.slice(-MAX_DIAGNOSTIC_BYTES)
				: next;
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
			request.onClaimComplete();
			return;
		}
		const detail = state.stderr.trim();
		request.onFailure(
			`Herdr claim worker exited with code ${String(code ?? UNKNOWN_ERROR)}${detail ? `: ${detail}` : ""}`,
		);
	});
}

export function startClaimWorker(
	request: ClaimWorkerRequest,
	options: ClaimWorkerOptions = {},
): ClaimWorkerHandle {
	const child = spawnWorkerProcess(request, options);
	const state: WorkerState = { settled: false, cancelled: false, stderr: "" };
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
