import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ExitAction, ExitActionResult } from "../exit-protocol/types.ts";
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

function commandOutput(result: {
	stdout: string;
	code: number;
}): string | null {
	return result.code === 0 ? result.stdout.trim() : null;
}

function commandFailure(result: { stderr: string; code: number }): string {
	return result.code === 0
		? ""
		: result.stderr.trim().replace(/\s+/g, " ").slice(0, 200);
}

export function createWorktreeModule(
	events: SharedEvents,
	dependencies: WorktreeModuleDependencies = {},
): WorktreeModule {
	const exec = dependencies.exec ?? spawnExec;
	const changeDirectory = dependencies.changeDirectory ?? process.chdir;
	let context: ExtensionContext | null = null;
	let baseline: WorktreeBaseline | null = null;
	let pendingCleanup = false;
	let operationGeneration = 0;

	const notify = (
		message: string,
		level: "info" | "warning" = "info",
	): void => {
		try {
			context?.ui.notify(message, level);
		} catch {
			// Headless sessions have no user-facing UI.
		}
	};

	const currentState = async (
		cwd: string,
	): Promise<WorktreeCurrentState | null> => {
		try {
			const [headResult, statusResult] = await Promise.all([
				exec("git", ["rev-parse", "HEAD"], { cwd }),
				exec("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
					cwd,
				}),
			]);
			const currentHead = commandOutput(headResult);
			const currentStatus = commandOutput(statusResult);
			if (!currentHead || currentStatus === null) return null;
			return { currentHead, currentStatus };
		} catch {
			return null;
		}
	};

	const cleanup = async (
		worktree: WorktreeBaseline,
		force: boolean,
		generation: number,
		successMessage = "Worktree and local branch deleted",
	): Promise<ExitActionResult> => {
		if (generation !== operationGeneration || baseline !== worktree)
			return "failed";
		try {
			changeDirectory(worktree.mainRoot);
		} catch (error) {
			notify(
				`Worktree cleanup failed: ${
					error instanceof Error ? error.message : String(error)
				}`,
				"warning",
			);
			return "failed";
		}
		const removeArgs = ["worktree", "remove"];
		if (force) removeArgs.push("--force");
		removeArgs.push(worktree.worktreePath);
		const removeResult = await exec("git", removeArgs, {
			cwd: worktree.mainRoot,
		});
		if (generation !== operationGeneration || baseline !== worktree)
			return "failed";
		if (removeResult.code !== 0) {
			notify(
				`Worktree cleanup failed: ${commandFailure(removeResult) || "worktree removal failed"}`,
				"warning",
			);
			return "failed";
		}

		const branchResult = await exec("git", ["branch", "-D", worktree.branch], {
			cwd: worktree.mainRoot,
		});
		if (generation !== operationGeneration || baseline !== worktree)
			return "failed";
		if (branchResult.code !== 0) {
			notify(
				`Worktree removed, but local branch deletion failed: ${commandFailure(branchResult) || "branch deletion failed"}`,
				"warning",
			);
			return "failed";
		}
		baseline = null;
		pendingCleanup = false;
		notify(successMessage);
		return "completed";
	};

	const cleanupAction = (
		worktree: WorktreeBaseline,
		generation: number,
	): ExitAction => ({
		id: "remove-worktree",
		label: `Delete worktree "${worktree.worktreePath}" and local branch "${worktree.branch}"`,
		execute: async () => {
			if (!context?.hasUI) return "failed";
			const state = await currentState(worktree.worktreePath);
			if (generation !== operationGeneration || baseline !== worktree)
				return "failed";
			if (!state) {
				notify("Worktree cleanup failed: Git status unavailable", "warning");
				return "failed";
			}
			let force = false;
			if (state.currentStatus !== "") {
				const confirmed = await context.ui.confirm(
					"Remove worktree with uncommitted changes?",
					`Worktree ${worktree.worktreePath} has uncommitted changes. Force removal will delete them.`,
				);
				if (!confirmed) return "failed";
				force = true;
			}
			return cleanup(worktree, force, generation);
		},
	});

	events.on("prMerged", (request) => {
		if (!context || !baseline || pendingCleanup) return;
		const worktree = baseline;
		const generation = operationGeneration;
		request.addAction({
			id: "remove-worktree",
			label: `Delete worktree "${worktree.worktreePath}" and local branch "${worktree.branch}"`,
			execute: async () => {
				if (generation !== operationGeneration || baseline !== worktree)
					return "failed";
				pendingCleanup = true;
				notify("Worktree cleanup scheduled for session exit");
				return "deferred";
			},
		});
	});

	events.on("sessionWillClose", async (request) => {
		if (!context || !baseline || request.payload.reason !== "quit") return;
		if (!context.hasUI) return;
		const worktree = baseline;
		const generation = operationGeneration;
		const state = await currentState(worktree.worktreePath);
		if (generation !== operationGeneration || baseline !== worktree) return;
		if (state && hasNoSessionWork(worktree, state)) {
			const result = await cleanup(
				worktree,
				false,
				generation,
				"Worktree deleted because no changes were made",
			);
			if (result === "completed") return;
		}
		request.addAction(cleanupAction(worktree, generation));
	});

	return {
		async sessionStart(nextContext) {
			const generation = ++operationGeneration;
			context = nextContext;
			baseline = null;
			pendingCleanup = false;
			const project = await inspectProject(exec, nextContext.cwd);
			if (
				generation !== operationGeneration ||
				!project.isWorktree ||
				!project.root ||
				!project.branch ||
				!project.mainRoot
			)
				return;

			const state = await currentState(nextContext.cwd);
			if (generation !== operationGeneration || !state) return;
			baseline = {
				worktreePath: project.root,
				branch: project.branch,
				mainRoot: project.mainRoot,
				initialHead: state.currentHead,
				initialStatus: state.currentStatus,
			};
		},
		deactivate() {
			++operationGeneration;
			context = null;
			baseline = null;
			pendingCleanup = false;
		},
	};
}
