export type { CommandResult } from "./command-data.ts";

import type { CommandResult } from "./command-data.ts";

export type Exec = (
	command: string,
	args: string[],
	options?: { timeout?: number; signal?: AbortSignal; cwd?: string },
) => Promise<CommandResult>;

export { spawnExec } from "./command-exec.ts";
