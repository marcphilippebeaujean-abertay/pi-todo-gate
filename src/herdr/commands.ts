import { execFileSync, spawn } from "node:child_process";
import { withWorkerMarker } from "../session.ts";
import { buildPiWorkerArgs } from "../shared/pi-worker.ts";
import {
	CLOSE_EVENT,
	DATA_EVENT,
	ERROR_EVENT,
	HERDR_COMMAND,
	HERDR_ENVIRONMENT,
	HIGH_THINKING,
	MISSING_CLAIM_EVIDENCE,
	PI_COMMAND,
	SIGTERM,
	STDIO_IGNORE,
	STDIO_PIPE,
	TAB_GET_COMMAND,
	UNKNOWN_ERROR,
	UTF8_ENCODING,
} from "./constants.ts";
import type {
	ClaimWorkerHandle,
	ClaimWorkerOptions,
	ClaimWorkerRequest,
	CommandRunner,
	StartBackgroundWorker,
	WorkerProcess,
	WorkerSpawner,
} from "./data.ts";
import { appendBounded, parseClaimResult } from "./data.ts";

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
		options.command ?? PI_COMMAND,
		buildPiWorkerArgs(request.prompt, {
			instructions: request.instructions,
			thinking: HIGH_THINKING,
		}),
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

export function isInsideHerdr(): boolean {
	return process.env[HERDR_ENVIRONMENT] === "1";
}

export function runCommand(
	cwd: string,
	command: string,
	args: string[],
): string {
	return execFileSync(command, args, {
		cwd,
		encoding: UTF8_ENCODING,
		stdio: [STDIO_IGNORE, STDIO_PIPE, STDIO_IGNORE],
	});
}

interface CwdReference {
	current: string;
}

export function boundCommandRunner(
	cwd: string | (() => string) | CwdReference,
	execute: typeof runCommand = runCommand,
): CommandRunner {
	return (command, args) => {
		const isFunctionReference = typeof cwd === "function";
		if (isFunctionReference) return execute(cwd(), command, args);
		const currentCwd = typeof cwd === "string" ? cwd : cwd.current;
		return execute(currentCwd, command, args);
	};
}

function jsonResult<T>(output: string): T | undefined {
	try {
		return JSON.parse(output) as T;
	} catch {
		return undefined;
	}
}

export function tabLabel(commandRunner: CommandRunner): string | undefined {
	const tabId = process.env.HERDR_TAB_ID;
	const hasTabId = Boolean(tabId);
	if (!hasTabId) return undefined;
	const response = jsonResult<{ result?: { tab?: { label?: string } } }>(
		commandRunner(HERDR_COMMAND, [...TAB_GET_COMMAND, tabId ?? ""]),
	);
	const label = response?.result?.tab?.label?.trim();
	return label || undefined;
}

export function defaultStartWorker(
	cwd: string,
	spawnWorker: WorkerSpawner | undefined,
	request: ClaimWorkerRequest,
): ReturnType<StartBackgroundWorker> {
	return startClaimWorker(request, { cwd, spawnWorker });
}
