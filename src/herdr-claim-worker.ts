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
	options: { cwd: string; env: NodeJS.ProcessEnv; shell: false },
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

const defaultSpawnWorker: WorkerSpawner = (command, args, options) =>
	spawn(command, [...args], {
		cwd: options.cwd,
		env: options.env,
		shell: options.shell,
	}) as unknown as WorkerProcess;

function appendBounded(current: string, chunk: Buffer | string): string {
	const next = `${current}${chunk.toString()}`;
	return next.length > MAX_DIAGNOSTIC_BYTES
		? next.slice(-MAX_DIAGNOSTIC_BYTES)
		: next;
}

function workerPrompt(request: ClaimWorkerRequest): string {
	return `${request.instructions}\n\nParent user prompt:\n${request.prompt}`;
}

export function startClaimWorker(
	request: ClaimWorkerRequest,
	options: ClaimWorkerOptions = {},
): ClaimWorkerHandle {
	const child = (options.spawnWorker ?? defaultSpawnWorker)(
		options.command ?? DEFAULT_COMMAND,
		["--mode", "json", "-p", "--no-session", workerPrompt(request)],
		{
			cwd: options.cwd ?? process.cwd(),
			env: { ...process.env, PI_SUBAGENT_CHILD: "1" },
			shell: false,
		},
	);
	let settled = false;
	let cancelled = false;
	let stderr = "";

	child.stdout.on("data", () => {
		// Worker output is intentionally private and never forwarded to the parent session.
	});
	child.stderr.on("data", (chunk) => {
		stderr = appendBounded(stderr, chunk);
	});

	const fail = (message: string): void => {
		if (settled || cancelled) return;
		settled = true;
		request.onFailure(message);
	};

	child.on("error", (...args) => {
		const error = args[0];
		const detail = error instanceof Error ? error.message : String(error ?? "unknown error");
		fail(`Herdr claim worker failed: ${detail}`);
	});
	child.on("close", (...args) => {
		if (settled || cancelled) return;
		const code = args[0];
		settled = true;
		if (code === 0) {
			request.onClaimComplete();
			return;
		}
		const detail = stderr.trim();
		request.onFailure(
			`Herdr claim worker exited with code ${String(code ?? "unknown")}${detail ? `: ${detail}` : ""}`,
		);
	});

	return {
		cancel(): void {
			if (settled || cancelled) return;
			cancelled = true;
			child.kill("SIGTERM");
		},
	};
}
