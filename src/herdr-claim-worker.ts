const STRING_LITERAL_IGNORE_0A6A4ADD = "ignore";
const STRING_LITERAL_PIPE_84D0A62A = "pipe";
const STRING_LITERAL_DATA_2AB445ED = "data";
const STRING_LITERAL_ERROR_10B292CE = "error";
const STRING_LITERAL_UNKNOWN_ERROR_9B7AFBD6 = "unknown error";
const STRING_LITERAL_CLOSE_388B7B9B = "close";
const STRING_LITERAL_UNKNOWN_79C37D82 = "unknown";
const STRING_LITERAL_SIGTERM_8355D6C4 = "SIGTERM";

import { spawn } from "node:child_process";
import {
	buildPiWorkerArgs,
	textFromAssistantMessage,
} from "./shared/pi-worker.ts";

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
			const hasText = text !== "";
			if (hasText) return claimResult(JSON.parse(text));
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
			stdio: [
				STRING_LITERAL_IGNORE_0A6A4ADD,
				STRING_LITERAL_PIPE_84D0A62A,
				STRING_LITERAL_PIPE_84D0A62A,
			],
		},
	);
	let settled = false;
	let cancelled = false;
	let stdout = "";
	let stderr = "";

	child.stdout.on(STRING_LITERAL_DATA_2AB445ED, (chunk) => {
		// Worker output is intentionally private and never forwarded to the parent session.
		stdout = appendBounded(stdout, chunk);
	});
	child.stderr.on(STRING_LITERAL_DATA_2AB445ED, (chunk) => {
		stderr = appendBounded(stderr, chunk);
	});

	const fail = (message: string): void => {
		if (settled || cancelled) return;
		settled = true;
		request.onFailure(message);
	};

	child.on(STRING_LITERAL_ERROR_10B292CE, (...args) => {
		const error = args[0];
		const detail =
			error instanceof Error
				? error.message
				: String(error ?? STRING_LITERAL_UNKNOWN_ERROR_9B7AFBD6);
		fail(`Herdr claim worker failed: ${detail}`);
	});
	child.on(STRING_LITERAL_CLOSE_388B7B9B, (...args) => {
		if (settled || cancelled) return;
		const code = args[0];
		settled = true;
		if (code === 0) {
			request.onClaimComplete(parseClaimResult(stdout));
			return;
		}
		const detail = stderr.trim();
		request.onFailure(
			`Herdr claim worker exited with code ${String(code ?? STRING_LITERAL_UNKNOWN_79C37D82)}${detail ? `: ${detail}` : ""}`,
		);
	});

	return {
		cancel(): void {
			if (settled || cancelled) return;
			cancelled = true;
			child.kill(STRING_LITERAL_SIGTERM_8355D6C4);
		},
	};
}
