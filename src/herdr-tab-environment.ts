import { execFileSync } from "node:child_process";
import {
	type ClaimWorkerRequest,
	startClaimWorker,
	type WorkerSpawner,
} from "./herdr/claim-worker.ts";
import type {
	CommandRunner,
	StartBackgroundWorker,
} from "./herdr-tab-claim.ts";

const HERDR_COMMAND = "herdr";
const HERDR_ENVIRONMENT = "HERDR_ENV";
const UTF8_ENCODING = "utf8";
const STDIO_IGNORE = "ignore";
const STDIO_PIPE = "pipe";
const TAB_GET_COMMAND = ["tab", "get"];
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
