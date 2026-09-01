export interface CommandResult {
	stdout: string;
	stderr: string;
	code: number;
	killed?: boolean;
}

export type Exec = (
	command: string,
	args: string[],
	options?: { timeout?: number; signal?: AbortSignal; cwd?: string },
) => Promise<CommandResult>;

export { spawnExec } from "../command-exec.ts";
