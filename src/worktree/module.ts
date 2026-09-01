import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { EXTENSION_CONSTANTS as C } from "../constants.ts";
import type { ExitActionResult } from "../exit-protocol/types.ts";
import { type Exec, spawnExec } from "../shared/command.ts";
import type {
	EventRequest,
	SharedEventPayloads,
	SharedEvents,
} from "../shared/events.ts";
import { inspectProject } from "../shared/project.ts";
import { confirmDirtyRemoval, createCleanupAction } from "./action.ts";
import { cleanupWorktree } from "./cleanup.ts";
import { currentWorktreeState, type WorktreeCurrentState } from "./commands.ts";
import { notifyWorktree } from "./notify.ts";
import { hasNoSessionWork, isCurrentWorktree } from "./state.ts";

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

export { hasNoSessionWork } from "./state.ts";
export type { WorktreeCurrentState };

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
		events.on(C.event.prMerged, this.onPrMerged.bind(this));
		events.on(C.event.sessionWillClose, this.onSessionWillClose.bind(this));
	}

	async sessionStart(nextContext: ExtensionContext): Promise<void> {
		const generation = ++this.operationGeneration;
		this.context = nextContext;
		this.baseline = null;
		this.pendingCleanup = false;
		const project = await inspectProject(this.exec, nextContext.cwd);
		const isCurrent = generation === this.operationGeneration;
		if (!isCurrent) return;
		const isWorktree = project.isWorktree;
		if (!isWorktree) return;
		const root = project.root;
		const branch = project.branch;
		const mainRoot = project.mainRoot;
		if (root === null) return;
		if (branch === null) return;
		if (mainRoot === null) return;
		const state = await currentWorktreeState(this.exec, nextContext.cwd);
		const isCurrentGeneration = generation === this.operationGeneration;
		if (!isCurrentGeneration) return;
		const hasState = state !== null;
		if (!hasState) return;
		this.baseline = {
			worktreePath: root,
			branch,
			mainRoot,
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
		const cleanupPending = this.pendingCleanup;
		if (cleanupPending) return;
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
		const isQuit = request.payload.reason === C.value.quit;
		if (!isQuit) return;
		if (context === null) return;
		if (worktree === null) return;
		const hasUI = context.hasUI;
		if (!hasUI) return;
		const generation = this.operationGeneration;
		const state = await currentWorktreeState(this.exec, worktree.worktreePath);
		const isCurrent = isCurrentWorktree(
			this.baseline,
			worktree,
			generation,
			this.operationGeneration,
		);
		if (!isCurrent) return;
		const noWork = state !== null && hasNoSessionWork(worktree, state);
		if (noWork) {
			const result = await this.cleanupNow(
				worktree,
				generation,
				false,
				C.worktree.noChanges,
			);
			const cleanupSucceeded = result === C.exit.completed;
			if (cleanupSucceeded) return;
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
		if (!isCurrent) return Promise.resolve(C.exit.failed);
		this.pendingCleanup = true;
		notifyWorktree(this.context, C.worktree.cleanupScheduled);
		return Promise.resolve(C.exit.deferred);
	}

	private async executeCleanup(
		worktree: WorktreeBaseline,
		generation: number,
	): Promise<ExitActionResult> {
		const context = this.context;
		if (context === null) return C.exit.failed;
		const canExecute = context.hasUI;
		if (!canExecute) return C.exit.failed;
		const state = await currentWorktreeState(this.exec, worktree.worktreePath);
		const isCurrent = isCurrentWorktree(
			this.baseline,
			worktree,
			generation,
			this.operationGeneration,
		);
		const hasState = state !== null;
		const cannotContinue = !isCurrent || !hasState;
		if (cannotContinue) return C.exit.failed;
		const hasChanges = state.currentStatus !== C.worktree.empty;
		let force = false;
		if (hasChanges) {
			force = await confirmDirtyRemoval(context, worktree);
			if (!force) return C.exit.failed;
		}
		return this.cleanupNow(
			worktree,
			generation,
			force,
			C.worktree.cleanupSuccess,
		);
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
		const cleanupSucceeded = result === C.exit.completed;
		if (cleanupSucceeded) {
			this.baseline = null;
			this.pendingCleanup = false;
			notifyWorktree(this.context, successMessage);
		}
		return result;
	}
}

export function createWorktreeModule(
	events: SharedEvents,
	dependencies: WorktreeModuleDependencies = {},
): WorktreeModule {
	return new Worktree(events, dependencies);
}
