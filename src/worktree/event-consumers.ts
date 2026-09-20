import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { publishSessionNotification } from "../event-publishers.ts";
import { type Exec, spawnExec } from "../shared/command.ts";
import { EXTENSION_CONSTANTS as C } from "../shared/constants.ts";
import type { EventHandler } from "../shared/events.ts";
import type { ExitActionResult } from "../shared/exit-actions.ts";
import {
	hasUncommittedChanges as inspectDirtyStatus,
	inspectProject,
} from "../shared/project.ts";
import type { SessionState } from "../state.ts";
import {
	CLEANUP_SKIPPED_SESSION_CHANGE,
	CLEANUP_SUCCESS,
	COMPLETED,
	EMPTY,
	FAILED,
	WARNING,
} from "./constants.ts";
import { publishWorktreeState } from "./event-publishers.ts";
import {
	cleanupWorktree,
	currentWorktreeState,
	isCurrentWorktree,
} from "./git.ts";
import type {
	WorktreeBaseline,
	WorktreeConsumer,
	WorktreeModuleOptions,
} from "./internal-state.ts";
import { notifyWorktree } from "./notifications.ts";

export class Worktree implements WorktreeConsumer {
	private readonly eventHandler: EventHandler;
	private readonly sessionState: SessionState;
	private readonly exec: Exec;
	private readonly changeDirectory: (path: string) => void;
	private context: ExtensionContext | null = null;
	private baseline: WorktreeBaseline | null = null;
	private uncommittedChanges = false;
	private refreshSequence = 0;
	private initializationSequence = 0;

	constructor(options: WorktreeModuleOptions) {
		this.eventHandler = options.eventHandler;
		this.sessionState = options.sessionState;
		const dependencies = options.dependencies ?? {};
		this.exec = options.exec ?? dependencies.exec ?? spawnExec;
		this.changeDirectory =
			options.changeDirectory ?? dependencies.changeDirectory ?? process.chdir;
		this.eventHandler.toolResultEvent.subscribe(({ event, context }) =>
			this.consumeToolResult(event, context),
		);
		this.eventHandler.sessionActivatedEvent.subscribe(
			({ context, sessionId }) => this.sessionStart(context, sessionId),
		);
		this.eventHandler.sessionDeactivatedEvent.subscribe(() =>
			this.deactivate(),
		);
	}

	async sessionStart(
		nextContext: ExtensionContext,
		expectedSessionId: string,
	): Promise<void> {
		const isCurrentActivation =
			this.sessionState.session.activeSessionId === expectedSessionId;
		if (!isCurrentActivation) return;
		this.refreshSequence += 1;
		const initializationSequence = ++this.initializationSequence;
		this.context = nextContext;
		this.baseline = null;
		await this.initializeSession(
			nextContext,
			expectedSessionId,
			initializationSequence,
		);
	}

	private isCurrentSession(ctx: ExtensionContext, sessionId: string): boolean {
		const isCurrentContext = this.context === ctx;
		const activeSessionId = this.sessionState.session.activeSessionId;
		const hasCurrentSessionId = activeSessionId === sessionId;
		return isCurrentContext && hasCurrentSessionId;
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
		const expectedSessionId = this.sessionState.session.activeSessionId;
		if (expectedSessionId === null) return;
		const sequence = ++this.refreshSequence;
		await this.refreshStatus(context, expectedSessionId, sequence);
	}

	private emitState(gitStatePatch?: Partial<SessionState["gitState"]>): void {
		const moduleState =
			this.baseline === null
				? {}
				: {
						initialHead: this.baseline.initialHead,
						initialStatus: this.baseline.initialStatus,
					};
		void publishWorktreeState(this.eventHandler, moduleState, gitStatePatch);
	}

	private async refreshStatus(
		context: ExtensionContext,
		sessionId: string,
		sequence: number,
	): Promise<void> {
		const dirtyStatus = await inspectDirtyStatus(this.exec, context.cwd);
		const isCurrent = this.isCurrentSession(context, sessionId);
		const hasStatus = dirtyStatus !== null;
		const isCurrentAndHasStatus = isCurrent && hasStatus;
		const isLatestRequest = sequence === this.refreshSequence;
		const shouldSkipStatus = !isCurrentAndHasStatus || !isLatestRequest;
		if (shouldSkipStatus) return;
		this.uncommittedChanges = dirtyStatus;
		this.emitState({ hasUncommittedChanges: this.uncommittedChanges });
	}

	private async initializeSession(
		ctx: ExtensionContext,
		sessionId: string,
		initializationSequence: number,
	): Promise<void> {
		const isCurrentInitialization = () =>
			initializationSequence === this.initializationSequence;
		const project = await inspectProject(this.exec, ctx.cwd);
		const isCurrentContextAfterProject =
			isCurrentInitialization() && this.isCurrentSession(ctx, sessionId);
		if (!isCurrentContextAfterProject) return;
		const isNotWorktree = !project.isWorktree;
		const projectRoot = project.root;
		if (isNotWorktree) {
			await this.initializeNonWorktree(ctx, sessionId, isCurrentInitialization);
			return;
		}
		if (projectRoot === null) return;
		if (project.branch === null) return;
		if (project.mainRoot === null) return;
		const state = await currentWorktreeState(this.exec, ctx.cwd);
		if (state === null) return;
		const isCurrentContextAfterState =
			isCurrentInitialization() && this.isCurrentSession(ctx, sessionId);
		if (!isCurrentContextAfterState) return;
		this.baseline = {
			worktreePath: projectRoot,
			branch: project.branch,
			mainRoot: project.mainRoot,
			initialHead: state.currentHead,
			initialStatus: state.currentStatus,
		};
		this.uncommittedChanges = state.currentStatus !== EMPTY;
		this.emitState({
			branch: project.branch,
			isWorktree: project.isWorktree,
			worktreeRoot: project.root,
			mainRoot: project.mainRoot,
			hasUncommittedChanges: this.uncommittedChanges,
		});
	}

	private async initializeNonWorktree(
		ctx: ExtensionContext,
		sessionId: string,
		isCurrentInitialization: () => boolean,
	): Promise<void> {
		const dirtyStatus = await inspectDirtyStatus(this.exec, ctx.cwd);
		const isCurrentAfterDirtyStatus =
			isCurrentInitialization() && this.isCurrentSession(ctx, sessionId);
		const hasStatus = dirtyStatus !== null;
		const shouldSkipDirtyStatus = !isCurrentAfterDirtyStatus || !hasStatus;
		if (shouldSkipDirtyStatus) return;
		this.uncommittedChanges = dirtyStatus;
		this.emitState({
			hasUncommittedChanges: dirtyStatus,
		});
	}

	deactivate(): void {
		this.refreshSequence += 1;
		this.initializationSequence += 1;
		this.context = null;
		this.baseline = null;
		this.uncommittedChanges = false;
		void publishWorktreeState(this.eventHandler, {}, {});
	}

	getWorktreeInfo(): { worktreePath: string; branch: string } | null {
		if (this.baseline === null) return null;
		return {
			worktreePath: this.baseline.worktreePath,
			branch: this.baseline.branch,
		};
	}

	async hasUncommittedChanges(): Promise<boolean | null> {
		const context = this.context;
		if (context === null) return null;
		return inspectDirtyStatus(this.exec, context.cwd);
	}

	removeWorktree(options: { force: boolean }): Promise<ExitActionResult> {
		const context = this.context;
		if (context === null) return Promise.resolve(FAILED);
		const worktree = this.baseline;
		if (worktree === null) return Promise.resolve(FAILED);
		const expectedSessionId = this.sessionState.session.activeSessionId;
		if (expectedSessionId === null) return Promise.resolve(FAILED);
		return this.executeCleanup(
			context,
			expectedSessionId,
			worktree,
			options.force,
		);
	}

	private async executeCleanup(
		context: ExtensionContext,
		sessionId: string,
		worktree: WorktreeBaseline,
		force: boolean,
	): Promise<ExitActionResult> {
		const state = await currentWorktreeState(this.exec, worktree.worktreePath);
		const isCurrentWorktreeState = isCurrentWorktree(this.baseline, worktree);
		if (!isCurrentWorktreeState) {
			await publishSessionNotification(
				this.eventHandler,
				CLEANUP_SKIPPED_SESSION_CHANGE,
				WARNING,
			);
			return FAILED;
		}
		const hasNoState = state === null;
		if (hasNoState) {
			notifyWorktree(this.context, C.worktree.statusUnavailable, "warning");
			return FAILED;
		}
		const hasChanges = state.currentStatus !== EMPTY;
		const shouldRejectDirtyCleanup = hasChanges && !force;
		if (shouldRejectDirtyCleanup) return FAILED;
		return this.cleanupNow(
			context,
			sessionId,
			worktree,
			force,
			CLEANUP_SUCCESS,
		);
	}

	private async cleanupNow(
		context: ExtensionContext,
		sessionId: string,
		worktree: WorktreeBaseline,
		force: boolean,
		successMessage: string,
	): Promise<ExitActionResult> {
		const cleanupState = { value: false };
		const result = await cleanupWorktree(worktree, force, {
			exec: this.exec,
			changeDirectory: this.changeDirectory,
			notify: notifyWorktree.bind(null, context),
			worktreeRemoved: cleanupState,
			isCurrent: () =>
				this.isCurrentSession(context, sessionId) &&
				isCurrentWorktree(this.baseline, worktree),
			notifySession: (message) =>
				publishSessionNotification(this.eventHandler, message, WARNING),
		});
		const isCurrentAfterCleanup =
			this.isCurrentSession(context, sessionId) &&
			isCurrentWorktree(this.baseline, worktree);
		if (!isCurrentAfterCleanup) return FAILED;
		const worktreeWasRemoved = cleanupState.value;
		if (worktreeWasRemoved) {
			this.baseline = null;
			this.emitState();
		}
		const cleanupCompleted = result === COMPLETED;
		if (cleanupCompleted) notifyWorktree(this.context, successMessage);
		return result;
	}
}
