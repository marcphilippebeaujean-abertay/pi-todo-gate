import { execFileSync } from "node:child_process";
import { isLinkedWorktreePaths, parseBranchName } from "./git.ts";
import type {
	CommandRunner,
	StartBackgroundWorker,
} from "./herdr-claim-gate.ts";
import {
	type ClaimWorkerRequest,
	startClaimWorker,
	type WorkerSpawner,
} from "./herdr-claim-worker.ts";

const GIT_COMMAND = "git";
const HERDR_COMMAND = "herdr";
const HERDR_ENVIRONMENT = "HERDR_ENV";
const SUBAGENT_ENVIRONMENT = "PI_SUBAGENT_CHILD";
const UTF8_ENCODING = "utf8";
const STDIO_IGNORE = "ignore";
const STDIO_PIPE = "pipe";
const GIT_DIRECTORY_ARGS = ["rev-parse", "--git-dir"];
const COMMON_DIRECTORY_ARGS = ["rev-parse", "--git-common-dir"];
const CURRENT_BRANCH_ARGS = ["branch", "--show-current"];
const TAB_GET_COMMAND = ["tab", "get"];
const TAB_RENAME_COMMAND = ["tab", "rename"];
export function isSubagent(): boolean {
	return process.env[SUBAGENT_ENVIRONMENT] === "1";
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

export function isDefaultTabLabel(label: string | undefined): boolean {
	return label !== undefined && /^\d+$/.test(label);
}

export function defaultStartWorker(
	cwd: string,
	spawnWorker: WorkerSpawner | undefined,
	request: ClaimWorkerRequest,
): ReturnType<StartBackgroundWorker> {
	return startClaimWorker(request, { cwd, spawnWorker });
}

export function claimWorktreeTab(
	commandRunner: CommandRunner,
	cwd: string,
): boolean {
	try {
		const gitDir = commandRunner(GIT_COMMAND, GIT_DIRECTORY_ARGS);
		const commonDir = commandRunner(GIT_COMMAND, COMMON_DIRECTORY_ARGS);
		const isLinkedWorktree = isLinkedWorktreePaths(cwd, gitDir, commonDir);
		if (!isLinkedWorktree) return false;

		const tabId = process.env.HERDR_TAB_ID;
		const branchName = parseBranchName(
			commandRunner(GIT_COMMAND, CURRENT_BRANCH_ARGS),
		);
		const defaultTabLabel = tabLabel(commandRunner);
		const hasTab = Boolean(tabId);
		const hasBranch = Boolean(branchName);
		const hasDefaultTabLabel = isDefaultTabLabel(defaultTabLabel);
		const canRenameTab = hasTab && hasBranch;
		if (!canRenameTab) return false;
		if (!hasDefaultTabLabel) return false;

		commandRunner(HERDR_COMMAND, [
			...TAB_RENAME_COMMAND,
			tabId ?? "",
			branchName ?? "",
		]);
		return true;
	} catch {
		return false;
	}
}
