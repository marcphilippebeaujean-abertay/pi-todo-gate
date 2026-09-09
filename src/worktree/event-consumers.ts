import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type Exec, spawnExec } from "../shared/command.ts";
import type {
	EventRequest,
	SharedEventPayloads,
	SharedEvents,
} from "../shared/events.ts";
import type { ExitActionResult } from "../shared/exit-actions.ts";
import { inspectProject } from "../shared/project.ts";
import { cleanupWorktree, currentWorktreeState } from "./commands.ts";
import {
	CLEANUP_SCHEDULED,
	CLEANUP_SUCCESS,
	COMPLETED,
	DEFERRED,
	EMPTY,
	FAILED,
	NO_CHANGES,
	QUIT,
} from "./constants.ts";
import type {
	WorktreeBaseline,
	WorktreeModule,
	WorktreeModuleDependencies,
} from "./data.ts";
import { hasNoSessionWork, isCurrentWorktree } from "./data.ts";
import { createCleanupAction } from "./event-publishers.ts";
import { notifyWorktree } from "./notifications.ts";
import { confirmDirtyRemoval } from "./user-prompts.ts";

type CloseRequest = EventRequest<SharedEventPayloads["sessionWillClose"]>;
type MergeRequest = EventRequest<SharedEventPayloads["prMerged"]>;

class Worktree implements WorktreeModule {
	private readonly exec: Exec;
	private readonly changeDirectory: (path: string) => void;
	private context: ExtensionContext | null = null;
	private baseline: WorktreeBaseline | null = null;
	private pendingCleanup = false;
	private operationGeneration = 0;

	constructor(events: SharedEvents, dependencies: WorktreeModuleDependencies) {
		this.exec = dependencies.exec ?? spawnExec;
		this.changeDirectory = dependencies.changeDirectory ?? process.chdir;
		events.on("prMerged", this.onPrMerged.bind(this));
		events.on("sessionWillClose", this.onSessionWillClose.bind(this));
	}

	async sessionStart(nextContext: ExtensionContext): Promise<void> {
		const generation = ++this.operationGeneration;
		this.context = nextContext;
		this.baseline = null;
		this.pendingCleanup = false;
		const project = await inspectProject(this.exec, nextContext.cwd);
		const isStale = generation !== this.operationGeneration;
		if (isStale) return;
		const isNotWorktree = !project.isWorktree;
		if (isNotWorktree) return;
		if (project.root === null) return;
		if (project.branch === null) return;
		if (project.mainRoot === null) return;
		const state = await currentWorktreeState(this.exec, nextContext.cwd);
		const stateIsStale = generation !== this.operationGeneration;
		if (stateIsStale) return;
		if (state === null) return;
		this.baseline = {
			worktreePath: project.root,
			branch: project.branch,
			mainRoot: project.mainRoot,
			initialHead: state.currentHead,
			initialStatus: state.currentStatus,
		};
	}

	deactivate(): void {
		this.operationGeneration += 1;
		this.context = null;
		this.baseline = null;
		this.pendingCleanup = false;
	}

	private onPrMerged(request: MergeRequest): void {
		if (this.context === null) return;
		if (this.baseline === null) return;
		const hasPendingCleanup = this.pendingCleanup;
		if (hasPendingCleanup) return;
		const worktree = this.baseline;
		const generation = this.operationGeneration;
		request.addAction(
			createCleanupAction(
				worktree,
				this.scheduleCleanup.bind(this, worktree, generation),
			),
		);
	}

	private async onSessionWillClose(request: CloseRequest): Promise<void> {
		const context = this.context;
		const worktree = this.baseline;
		const isQuit = request.payload.reason === QUIT;
		if (!isQuit) return;
		const hasNoContext = context === null;
		if (hasNoContext) return;
		const hasNoWorktree = worktree === null;
		if (hasNoWorktree) return;
		const hasNoUi = !context.hasUI;
		if (hasNoUi) return;
		const generation = this.operationGeneration;
		const state = await currentWorktreeState(this.exec, worktree.worktreePath);
		const isCurrent = isCurrentWorktree(
			this.baseline,
			worktree,
			generation,
			this.operationGeneration,
		);
		if (!isCurrent) return;
		const hasState = state !== null;
		if (hasState) {
			const hasNoWork = hasNoSessionWork(worktree, state);
			if (!hasNoWork) {
				request.addAction(
					createCleanupAction(
						worktree,
						this.executeCleanup.bind(this, worktree, generation),
					),
				);
				return;
			}
			const result = await this.cleanupNow(
				worktree,
				generation,
				false,
				NO_CHANGES,
			);
			const cleanupCompleted = result === COMPLETED;
			if (cleanupCompleted) return;
		}
		request.addAction(
			createCleanupAction(
				worktree,
				this.executeCleanup.bind(this, worktree, generation),
			),
		);
	}

	private scheduleCleanup(
		worktree: WorktreeBaseline,
		generation: number,
	): Promise<ExitActionResult> {
		const isCurrent = isCurrentWorktree(
			this.baseline,
			worktree,
			generation,
			this.operationGeneration,
		);
		if (!isCurrent) return Promise.resolve(FAILED);
		this.pendingCleanup = true;
		notifyWorktree(this.context, CLEANUP_SCHEDULED);
		return Promise.resolve(DEFERRED);
	}

	private async executeCleanup(
		worktree: WorktreeBaseline,
		generation: number,
	): Promise<ExitActionResult> {
		const context = this.context;
		if (context === null) return FAILED;
		const hasNoUi = !context.hasUI;
		if (hasNoUi) return FAILED;
		const state = await currentWorktreeState(this.exec, worktree.worktreePath);
		const isCurrent = isCurrentWorktree(
			this.baseline,
			worktree,
			generation,
			this.operationGeneration,
		);
		if (!isCurrent) return FAILED;
		const hasNoState = state === null;
		if (hasNoState) return FAILED;
		let force = false;
		const hasChanges = state.currentStatus !== EMPTY;
		if (hasChanges) {
			force = await confirmDirtyRemoval(context, worktree);
			if (!force) return FAILED;
		}
		return this.cleanupNow(worktree, generation, force, CLEANUP_SUCCESS);
	}

	private async cleanupNow(
		worktree: WorktreeBaseline,
		generation: number,
		force: boolean,
		successMessage: string,
	): Promise<ExitActionResult> {
		const result = await cleanupWorktree(worktree, force, {
			exec: this.exec,
			changeDirectory: this.changeDirectory,
			notify: notifyWorktree.bind(null, this.context),
			isCurrent: () =>
				isCurrentWorktree(
					this.baseline,
					worktree,
					generation,
					this.operationGeneration,
				),
		});
		const cleanupCompleted = result === COMPLETED;
		if (cleanupCompleted) {
			this.baseline = null;
			this.pendingCleanup = false;
			notifyWorktree(this.context, successMessage);
		}
		return result;
	}
}

export function createWorktreeConsumer(
	events: SharedEvents,
	dependencies: WorktreeModuleDependencies,
): WorktreeModule {
	return new Worktree(events, dependencies);
}
