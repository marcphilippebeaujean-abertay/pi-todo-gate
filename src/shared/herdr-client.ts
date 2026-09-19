import { execFileSync } from "node:child_process";

const STDIO_IGNORE = "ignore";
const STDIO_PIPE = "pipe";
const UTF8_ENCODING = "utf8";

export const HERDR_COMMAND = "herdr";
export const HERDR_ENVIRONMENT = "HERDR_ENV";
export const HERDR_TAB_ID = "HERDR_TAB_ID";
export const HERDR_PANE_ID = "HERDR_PANE_ID";

export interface CwdReference {
	current: string;
}

export type HerdrClient = (command: string, args: string[]) => string;

export function isInsideHerdr(): boolean {
	return process.env[HERDR_ENVIRONMENT] === "1";
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
