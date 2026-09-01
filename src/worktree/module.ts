import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type Exec, spawnExec } from "../shared/command.ts";
import type { SharedEvents } from "../shared/events.ts";
import { inspectProject } from "../shared/project.ts";

export interface WorktreeModuleDependencies {
	exec?: Exec;
	changeDirectory?: (path: string) => void;
}

export interface WorktreeModule {
	sessionStart(ctx: ExtensionContext): Promise<void>;
	deactivate(): void;
}

export interface WorktreeBaseline {
	worktreePath: string;
	branch: string;
	mainRoot: string;
	initialHead: string;
	initialStatus: string;
}

export interface WorktreeCurrentState {
	currentHead: string;
	currentStatus: string;
}

export function hasNoSessionWork(
	baseline: Pick<WorktreeBaseline, "initialHead" | "initialStatus">,
	current: WorktreeCurrentState,
): boolean {
	return (
		baseline.initialHead === current.currentHead &&
		baseline.initialStatus === "" &&
		current.currentStatus === ""
	);
}

function commandOutput(result: { stdout: string; code: number }): string | null {
	return result.code === 0 ? result.stdout.trim() : null;
}

export function createWorktreeModule(
	_events: SharedEvents,
	dependencies: WorktreeModuleDependencies = {},
): WorktreeModule {
	const exec = dependencies.exec ?? spawnExec;
	let context: Pick<ExtensionContext, "cwd"> | null = null;
	let baseline: WorktreeBaseline | null = null;
	let operationGeneration = 0;

	return {
		async sessionStart(nextContext) {
			const generation = ++operationGeneration;
			context = nextContext;
			baseline = null;
			const project = await inspectProject(exec, nextContext.cwd);
			if (
				generation !== operationGeneration ||
				!project.isWorktree ||
				!project.root ||
				!project.branch ||
				!project.mainRoot
			)
				return;

			const [headResult, statusResult] = await Promise.all([
				exec("git", ["rev-parse", "HEAD"], { cwd: nextContext.cwd }),
				exec(
					"git",
					["status", "--porcelain=v1", "--untracked-files=all"],
					{ cwd: nextContext.cwd },
				),
			]);
			const initialHead = commandOutput(headResult);
			const initialStatus = commandOutput(statusResult);
			if (
				generation !== operationGeneration ||
				!initialHead ||
				initialStatus === null
			)
				return;
			baseline = {
				worktreePath: project.root,
				branch: project.branch,
				mainRoot: project.mainRoot,
				initialHead,
				initialStatus,
			};
		},
		deactivate() {
			++operationGeneration;
			context = null;
			baseline = null;
		},
	};
}
