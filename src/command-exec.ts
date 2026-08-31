import { type ChildProcess, spawn } from "node:child_process";
import type { CommandResult } from "./git.ts";

const SIGTERM = "SIGTERM";
const ABORT_EVENT = "abort";
const DATA_EVENT = "data";
const ERROR_EVENT = "error";
const CLOSE_EVENT = "close";

interface ExecState {
	child: ChildProcess;
	resolve: (result: CommandResult) => void;
	stdout: string;
	stderr: string;
	killed: boolean;
	settled: boolean;
	options: { signal?: AbortSignal; timeout?: number };
	onAbort: () => void;
	timer?: ReturnType<typeof setTimeout>;
}

function noop(): void {}

function finish(state: ExecState, result: CommandResult): void {
	const isSettled = state.settled;
	if (isSettled) return;
	state.settled = true;
	state.resolve(result);
}

function appendStdout(state: ExecState, chunk: Buffer): void {
	state.stdout += chunk.toString();
}

function appendStderr(state: ExecState, chunk: Buffer): void {
	state.stderr += chunk.toString();
}

function finishError(state: ExecState, error: unknown): void {
	const hasTimer = state.timer !== undefined;
	if (hasTimer) clearTimeout(state.timer);
	state.options.signal?.removeEventListener(ABORT_EVENT, state.onAbort);
	const detail = error instanceof Error ? error.message : String(error);
	finish(state, {
		stdout: state.stdout,
		stderr: `${state.stderr}${detail}`,
		code: 1,
		killed: state.killed,
	});
}

function finishClose(state: ExecState, code: number | null): void {
	state.options.signal?.removeEventListener(ABORT_EVENT, state.onAbort);
	finish(state, {
		stdout: state.stdout,
		stderr: state.stderr,
		code: code ?? 1,
		killed: state.killed,
	});
}

function killProcess(state: ExecState): void {
	state.killed = true;
	state.child.kill(SIGTERM);
}

function registerProcessListeners(state: ExecState): void {
	state.child.stdout?.on(DATA_EVENT, appendStdout.bind(null, state));
	state.child.stderr?.on(DATA_EVENT, appendStderr.bind(null, state));
	state.child.on(ERROR_EVENT, finishError.bind(null, state));
	state.child.on(CLOSE_EVENT, finishClose.bind(null, state));
}

export function spawnExec(
	command: string,
	args: string[],
	options: { timeout?: number; signal?: AbortSignal; cwd?: string } = {},
): Promise<CommandResult> {
	return new Promise((resolveResult) => {
		const child = spawn(command, args, { cwd: options.cwd, shell: false });
		const state: ExecState = {
			child,
			resolve: resolveResult,
			stdout: "",
			stderr: "",
			killed: false,
			settled: false,
			options,
			onAbort: noop,
		};
		state.onAbort = killProcess.bind(null, state);
		options.signal?.addEventListener(ABORT_EVENT, state.onAbort, {
			once: true,
		});
		const hasTimeout = options.timeout !== undefined;
		if (hasTimeout)
			state.timer = setTimeout(killProcess.bind(null, state), options.timeout);
		registerProcessListeners(state);
	});
}
