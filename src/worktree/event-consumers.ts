import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type Exec, spawnExec } from "../shared/command.ts";
import { EXTENSION_CONSTANTS as C } from "../shared/constants.ts";
import type { EventHandler } from "../shared/events.ts";
import type { ExitActionResult } from "../shared/exit-actions.ts";
import {
	hasUncommittedChanges as inspectDirtyStatus,
	inspectProject,
} from "../shared/project.ts";
import type { SessionState } from "../state.ts";
import { CLEANUP_SUCCESS, COMPLETED, EMPTY, FAILED } from "./constants.ts";
import {
	cleanupWorktree,
	currentWorktreeState,
	isCurrentWorktree,
} from "./git.ts";
import { notifyWorktree } from "./notifications.ts";
import type {
	WorktreeBaseline,
	WorktreeModule,
	WorktreeModuleDependencies,
	WorktreeModuleOptions,
} from "./state.ts";
import { confirmDirtyRemoval } from "./user-prompts.ts";

class Worktree implements WorktreeModule {
	private readonly eventHandler: EventHandler;
	private readonly sessionState: SessionState;
	private readonly exec: Exec;
	private readonly changeDirectory: (path: string) => void;
	private readonly formatPrStatus:
		| NonNullable<WorktreeModuleDependencies["formatPrStatus"]>
		| undefined;
	private readonly formatTaskStatus:
		| NonNullable<WorktreeModuleDependencies["formatTaskStatus"]>
		| undefined;
	private context: ExtensionContext | null = null;
	private baseline: WorktreeBaseline | null = null;
	private hasUncommittedChanges = false;
	private sessionGeneration = 0;

	constructor(options: WorktreeModuleOptions) {
		this.eventHandler = options.eventHandler;
		this.sessionState = options.sessionState;
		const dependencies = options.dependencies ?? {};
		this.exec = dependencies.exec ?? spawnExec;
		this.changeDirectory = dependencies.changeDirectory ?? process.chdir;
		this.formatPrStatus = dependencies.formatPrStatus;
		this.formatTaskStatus = dependencies.formatTaskStatus;
		this.eventHandler.toolResultEvent.subscribe(({ event, context }) =>
			this.consumeToolResult(event, context),
		);
		this.eventHandler.sessionResetEvent.subscribe(() => this.deactivate());
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

	private async consumeToolResult(
		event: { toolName: string; isError: boolean },
		context: ExtensionContext,
	): Promise<void> {
		const isCurrentContext = this.context === context;
		const isError = event.isError;
		const shouldSkipResult = !isCurrentContext || isError;
		if (shouldSkipResult) return;
		const toolName = event.toolName;
		const isEditTool = toolName === C.tool.edit;
		const isWriteTool = toolName === C.tool.write;
		const isFileMutation = isEditTool || isWriteTool;
		const isBashTool = toolName === C.tool.bash;
		const shouldRefresh = isFileMutation || isBashTool;
		const shouldSkipRefresh = !shouldRefresh;
		if (shouldSkipRefresh) return;
		await this.refreshStatus(context, this.sessionGeneration);
	}

	private emitState(gitStatePatch?: Record<string, unknown>): void {
		void this.eventHandler.moduleStateChangedEvent.emit({
			moduleId: C.module.worktree,
			moduleState: {
				...(this.baseline ?? {}),
				hasUncommittedChanges: this.hasUncommittedChanges,
			},
			...(gitStatePatch === undefined ? {} : { gitStatePatch }),
		});
	}

	private emitFooterStatus(context: ExtensionContext): void {
		const formatPrStatus = this.formatPrStatus;
		const hasFormatter = formatPrStatus !== undefined;
		const shouldSkipStatus = !hasFormatter;
		if (shouldSkipStatus) return;
		const application = this.sessionState.moduleState[C.module.application];
		const isApplicationRecord =
			typeof application === "object" && application !== null;
		const session = isApplicationRecord
			? (application as {
					state?: { prUrl?: string; taskUrl?: string; taskName?: string };
				})
			: undefined;
		void this.eventHandler.footerUpdateEvent.emit({
			footerType: C.status.pr,
			isLoading: false,
			text: formatPrStatus(
				session?.state?.prUrl,
				context.ui.theme,
				this.hasUncommittedChanges,
			),
			isVisible: true,
		});
		const formatTaskStatus = this.formatTaskStatus;
		if (formatTaskStatus === undefined) return;
		void this.eventHandler.footerUpdateEvent.emit({
			footerType: C.status.task,
			isLoading: false,
			text: formatTaskStatus(
				session?.state?.taskUrl,
				context.ui.theme,
				session?.state?.taskName,
			),
			isVisible: true,
		});
	}

	private async refreshStatus(
		context: ExtensionContext,
		generation: number,
	): Promise<void> {
		const dirtyStatus = await inspectDirtyStatus(this.exec, context.cwd);
		const isCurrent = this.isCurrentSession(context, generation);
		const hasStatus = dirtyStatus !== null;
		const shouldSkipStatus = !isCurrent || !hasStatus;
		if (shouldSkipStatus) return;
		this.hasUncommittedChanges = dirtyStatus;
		this.updateApplicationSessionStatus();
		this.emitState({ hasUncommittedChanges: this.hasUncommittedChanges });
		this.emitFooterStatus(context);
	}

	private updateApplicationSessionStatus(): void {
		const application = this.sessionState.moduleState[C.module.application];
		const isApplicationRecord =
			typeof application === "object" && application !== null;
		if (!isApplicationRecord) return;
		const session = application as { hasUncommittedChanges?: boolean };
		session.hasUncommittedChanges = this.hasUncommittedChanges;
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
		this.hasUncommittedChanges = state.currentStatus !== EMPTY;
		this.updateApplicationSessionStatus();
		this.emitState({
			branch: project.branch,
			isWorktree: project.isWorktree,
			worktreeRoot: project.root,
			mainRoot: project.mainRoot,
			hasUncommittedChanges: this.hasUncommittedChanges,
		});
		this.emitFooterStatus(ctx);
	}

	deactivate(): void {
		this.sessionGeneration += 1;
		this.context = null;
		this.baseline = null;
		this.hasUncommittedChanges = false;
		void this.eventHandler.moduleStateChangedEvent.emit({
			moduleId: C.module.worktree,
			moduleState: {},
			gitStatePatch: {},
		});
	}

	getWorktreeInfo(): { worktreePath: string; branch: string } | null {
		if (this.baseline === null) return null;
		return {
			worktreePath: this.baseline.worktreePath,
			branch: this.baseline.branch,
		};
	}

	removeWorktree(): Promise<ExitActionResult> {
		if (this.context === null) return Promise.resolve(FAILED);
		const worktree = this.baseline;
		if (worktree === null) return Promise.resolve(FAILED);
		return this.executeCleanup(worktree);
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
	options: WorktreeModuleOptions,
): WorktreeModule {
	return new Worktree(options);
}
