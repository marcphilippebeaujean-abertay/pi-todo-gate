import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type Exec, spawnExec } from "../shared/command.ts";
import { EXTENSION_CONSTANTS as C } from "../shared/constants.ts";
import type { SharedEvents } from "../shared/events.ts";
import type { ExitActionResult } from "../shared/exit-actions.ts";
import { inspectProject } from "../shared/project.ts";
import { CLEANUP_SUCCESS, COMPLETED, EMPTY, FAILED } from "./constants.ts";
import { createCleanupAction } from "./event-publishers.ts";
import {
	cleanupWorktree,
	currentWorktreeState,
	isCurrentWorktree,
} from "./git.ts";
import { notifyWorktree } from "./notifications.ts";
import type {
	MergeRequest,
	WorktreeBaseline,
	WorktreeModule,
	WorktreeModuleDependencies,
} from "./state.ts";
import { confirmDirtyRemoval } from "./user-prompts.ts";

class Worktree implements WorktreeModule {
	private readonly exec: Exec;
	private readonly changeDirectory: (path: string) => void;
	private context: ExtensionContext | null = null;
	private baseline: WorktreeBaseline | null = null;
	private sessionGeneration = 0;

	constructor(events: SharedEvents, dependencies: WorktreeModuleDependencies) {
		this.exec = dependencies.exec ?? spawnExec;
		this.changeDirectory = dependencies.changeDirectory ?? process.chdir;
		events.on(C.event.prMerged, this.onPrMerged.bind(this));
	}

	async sessionStart(nextContext: ExtensionContext): Promise<void> {
		const generation = ++this.sessionGeneration;
		this.context = nextContext;
		this.baseline = null;
		await this.initializeSession(nextContext, generation);
	}

	private isCurrentSession(ctx: ExtensionContext, generation: number): boolean {
		return this.context === ctx && this.sessionGeneration === generation;
	}

	private async initializeSession(
		ctx: ExtensionContext,
		generation: number,
	): Promise<void> {
		const project = await inspectProject(this.exec, ctx.cwd);
		const isCurrentContextAfterProject = this.isCurrentSession(ctx, generation);
		if (!isCurrentContextAfterProject) return;
		const isNotWorktree = !project.isWorktree;
		if (isNotWorktree) return;
		if (project.root === null) return;
		if (project.branch === null) return;
		if (project.mainRoot === null) return;
		const state = await currentWorktreeState(this.exec, ctx.cwd);
		if (state === null) return;
		const isCurrentContextAfterState = this.isCurrentSession(ctx, generation);
		if (!isCurrentContextAfterState) return;
		this.baseline = {
			worktreePath: project.root,
			branch: project.branch,
			mainRoot: project.mainRoot,
			initialHead: state.currentHead,
			initialStatus: state.currentStatus,
		};
	}

	deactivate(): void {
		this.sessionGeneration += 1;
		this.context = null;
		this.baseline = null;
	}

	private onPrMerged(request: MergeRequest): void {
		if (this.context === null) return;
		if (this.baseline === null) return;
		const worktree = this.baseline;
		request.addAction(
			createCleanupAction(worktree, this.executeCleanup.bind(this, worktree)),
		);
	}

	private async executeCleanup(
		worktree: WorktreeBaseline,
	): Promise<ExitActionResult> {
		const context = this.context;
		if (context === null) return FAILED;
		const hasNoUi = !context.hasUI;
		if (hasNoUi) return FAILED;
		const state = await currentWorktreeState(this.exec, worktree.worktreePath);
		const isCurrent = isCurrentWorktree(this.baseline, worktree);
		if (!isCurrent) return FAILED;
		const hasNoState = state === null;
		if (hasNoState) {
			notifyWorktree(this.context, C.worktree.statusUnavailable, "warning");
			return FAILED;
		}
		let force = false;
		const hasChanges = state.currentStatus !== EMPTY;
		if (hasChanges) {
			force = await confirmDirtyRemoval(context, worktree);
			if (!force) return FAILED;
		}
		return this.cleanupNow(worktree, force, CLEANUP_SUCCESS);
	}

	private async cleanupNow(
		worktree: WorktreeBaseline,
		force: boolean,
		successMessage: string,
	): Promise<ExitActionResult> {
		const cleanupState = { value: false };
		const result = await cleanupWorktree(worktree, force, {
			exec: this.exec,
			changeDirectory: this.changeDirectory,
			notify: notifyWorktree.bind(null, this.context),
			worktreeRemoved: cleanupState,
			isCurrent: () => isCurrentWorktree(this.baseline, worktree),
		});
		const worktreeWasRemoved = cleanupState.value;
		if (worktreeWasRemoved) this.baseline = null;
		const cleanupCompleted = result === COMPLETED;
		if (cleanupCompleted) notifyWorktree(this.context, successMessage);
		return result;
	}
}

export function createWorktreeConsumer(
	events: SharedEvents,
	dependencies: WorktreeModuleDependencies,
): WorktreeModule {
	return new Worktree(events, dependencies);
}
