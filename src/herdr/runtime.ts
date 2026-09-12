import { execFileSync } from "node:child_process";
import {
	HERDR_COMMAND,
	HERDR_ENVIRONMENT,
	STDIO_IGNORE,
	STDIO_PIPE,
	TAB_GET_COMMAND,
	UTF8_ENCODING,
} from "./constants.ts";
import type { CommandRunner, CwdReference } from "./state.ts";

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

export function boundCommandRunner(
	cwd: string | (() => string) | CwdReference,
	execute?: typeof runCommand,
): CommandRunner {
	const run = execute ?? runCommand;
	return (command, args) => {
		const isFunctionReference = typeof cwd === "function";
		if (isFunctionReference) return run(cwd(), command, args);
		const currentCwd = typeof cwd === "string" ? cwd : cwd.current;
		return run(currentCwd, command, args);
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
	const resolvedTabId = tabId ?? "";
	const response = jsonResult<{ result?: { tab?: { label?: string } } }>(
		commandRunner(HERDR_COMMAND, [
			TAB_GET_COMMAND[0],
			TAB_GET_COMMAND[1],
			resolvedTabId,
		]),
	);
	const label = response?.result?.tab?.label?.trim();
	return label || undefined;
}
