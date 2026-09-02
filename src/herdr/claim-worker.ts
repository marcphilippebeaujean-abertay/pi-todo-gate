import { spawn } from "node:child_process";
import {
	buildPiWorkerArgs,
	textFromAssistantMessage,
} from "../shared/pi-worker.ts";

export interface ClaimWorkerResult {
	tabId: string;
	label: string;
}

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
const MAX_DIAGNOSTIC_BYTES = 500;

const defaultSpawnWorker: WorkerSpawner = (command, args, options) =>
	spawn(command, [...args], {
		cwd: options.cwd,
		env: options.env,
		shell: options.shell,
		stdio: options.stdio,
	}) as unknown as WorkerProcess;

function appendBounded(current: string, chunk: Buffer | string): string {
	const next = `${current}${chunk.toString()}`;
	return next.length > MAX_DIAGNOSTIC_BYTES
		? next.slice(-MAX_DIAGNOSTIC_BYTES)
		: next;
}

function claimResult(value: unknown): ClaimWorkerResult | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const result = value as {
		status?: unknown;
		tabId?: unknown;
		label?: unknown;
	};
	if (
		result.status !== "claimed" ||
		typeof result.tabId !== "string" ||
		!result.tabId.trim() ||
		typeof result.label !== "string" ||
		!result.label.trim()
	)
		return undefined;
	return { tabId: result.tabId, label: result.label };
}

function parseClaimResult(stdout: string): ClaimWorkerResult | undefined {
	for (const line of stdout.split(/\r?\n/).reverse()) {
		if (!line.trim()) continue;
		try {
			const event = JSON.parse(line) as { message?: unknown };
			const text = textFromAssistantMessage(event.message).trim();
			if (text) return claimResult(JSON.parse(text));
			return claimResult(event);
		} catch {
			// Keep searching earlier worker output.
		}
	}
	return undefined;
}

export function startClaimWorker(
	request: ClaimWorkerRequest,
	options: ClaimWorkerOptions = {},
): ClaimWorkerHandle {
	const child = (options.spawnWorker ?? defaultSpawnWorker)(
		options.command ?? DEFAULT_COMMAND,
		buildPiWorkerArgs(request.prompt, {
			instructions: request.instructions,
		}),
		{
			cwd: options.cwd ?? process.cwd(),
			env: { ...process.env, PI_SUBAGENT_CHILD: "1" },
			shell: false,
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
	let settled = false;
	let cancelled = false;
	let stdout = "";
	let stderr = "";

	child.stdout.on("data", (chunk) => {
		// Worker output is intentionally private and never forwarded to the parent session.
		stdout = appendBounded(stdout, chunk);
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
		const detail =
			error instanceof Error ? error.message : String(error ?? "unknown error");
		fail(`Herdr claim worker failed: ${detail}`);
	});
	child.on("close", (...args) => {
		if (settled || cancelled) return;
		const code = args[0];
		settled = true;
		if (code === 0) {
			request.onClaimComplete(parseClaimResult(stdout));
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
