import { spawn } from "node:child_process";
import { buildPiWorkerArgs } from "./pi-worker.ts";
import type {
	PiWorkerHandle,
	PiWorkerProcess,
	PiWorkerRequest,
	PiWorkerRuntimeOptions,
	PiWorkerSpawner,
} from "./pi-worker-data.ts";
import { monitorPiWorker } from "./pi-worker-process.ts";
import { withWorkerMarker } from "./session.ts";

export type {
	PiWorkerHandle,
	PiWorkerProcess,
	PiWorkerRequest,
	PiWorkerRuntimeOptions,
	PiWorkerSpawner,
	PiWorkerSpawnOptions,
	WorkerOutputStream,
} from "./pi-worker-data.ts";

const DEFAULT_PI_COMMAND = "pi";
const WORKER_HIGH_THINKING = "high";
const STDIO_IGNORE = "ignore";
const STDIO_PIPE = "pipe";

const defaultPiWorkerSpawner: PiWorkerSpawner = (command, args, options) =>
	spawn(command, [...args], {
		cwd: options.cwd,
		env: options.env,
		shell: options.shell,
		stdio: options.stdio,
	}) as unknown as PiWorkerProcess;

export function startPiWorker<TResult>(
	request: PiWorkerRequest<TResult>,
	options?: PiWorkerRuntimeOptions,
): PiWorkerHandle {
	const resolvedOptions = options ?? {};
	const spawnWorker = resolvedOptions.spawnWorker ?? defaultPiWorkerSpawner;
	const child = spawnWorker(
		resolvedOptions.command ?? DEFAULT_PI_COMMAND,
		buildPiWorkerArgs(request.prompt, {
			instructions: request.instructions,
			thinking: WORKER_HIGH_THINKING,
		}),
		{
			cwd: resolvedOptions.cwd ?? process.cwd(),
			env: withWorkerMarker(),
			shell: false,
			stdio: [STDIO_IGNORE, STDIO_PIPE, STDIO_PIPE],
		},
	);
	return monitorPiWorker(child, request);
}
