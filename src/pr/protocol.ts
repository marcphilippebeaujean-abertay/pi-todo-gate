const GH_COMMAND = "gh";
const PR_COMMAND = "pr";
const MERGE_COMMAND = "merge";
const MERGE_MODE = "--merge";

import type { CommandResult, Exec } from "../shared/command.ts";

export function mergePinnedPr(
	exec: Exec,
	cwd: string,
	prUrl: string,
): Promise<CommandResult> {
	return exec(GH_COMMAND, [PR_COMMAND, MERGE_COMMAND, prUrl, MERGE_MODE], {
		cwd,
	});
}
