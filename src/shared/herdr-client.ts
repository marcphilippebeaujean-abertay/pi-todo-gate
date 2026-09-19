import { execFileSync } from "node:child_process";

const STDIO_IGNORE = "ignore";
const STDIO_PIPE = "pipe";
const UTF8_ENCODING = "utf8";

export const HERDR_COMMAND = "herdr";
export const HERDR_ENVIRONMENT = "HERDR_ENV";
export const HERDR_TAB_ID = "HERDR_TAB_ID";
export const HERDR_PANE_ID = "HERDR_PANE_ID";
const TAB_GET_COMMAND = ["tab", "get"] as const;

export interface CwdReference {
	current: string;
}

export type HerdrClient = (command: string, args: string[]) => string;

export function isInsideHerdr(): boolean {
	return process.env[HERDR_ENVIRONMENT] === "1";
}

export function currentPaneId(): string | undefined {
	const paneId = process.env[HERDR_PANE_ID]?.trim();
	return paneId || undefined;
}

function jsonResult<T>(output: string): T | undefined {
	try {
		return JSON.parse(output) as T;
	} catch {
		return undefined;
	}
}

export function tabLabel(herdrClient: HerdrClient): string | undefined {
	const tabId = process.env[HERDR_TAB_ID];
	const hasTabId = Boolean(tabId);
	if (!hasTabId) return undefined;
	const response = jsonResult<{ result?: { tab?: { label?: string } } }>(
		herdrClient(HERDR_COMMAND, [...TAB_GET_COMMAND, tabId ?? ""]),
	);
	const label = response?.result?.tab?.label?.trim();
	return label || undefined;
}

export function runHerdrCommand(
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

export function boundHerdrClient(
	cwd: string | (() => string) | CwdReference,
	execute?: typeof runHerdrCommand,
): HerdrClient {
	const run = execute ?? runHerdrCommand;
	return (command, args) => {
		const currentCwd =
			typeof cwd === "function"
				? cwd()
				: typeof cwd === "string"
					? cwd
					: cwd.current;
		return run(currentCwd, command, args);
	};
}
