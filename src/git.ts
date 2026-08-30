import type { Exec } from "./shared/command.ts";
import { inspectProject, type ProjectInfo } from "./shared/project.ts";

export {
	findOpenPr,
	findPrState,
	matchesPinnedPr,
	mergeCommand,
	type OpenPrInfo,
} from "./pr/git.ts";
export type { CommandResult, Exec } from "./shared/command.ts";
export { spawnExec } from "./shared/command.ts";

export type WorktreeInfo = ProjectInfo;

export async function inspectWorktree(
	exec: Exec,
	cwd: string,
): Promise<WorktreeInfo> {
	return inspectProject(exec, cwd);
}
