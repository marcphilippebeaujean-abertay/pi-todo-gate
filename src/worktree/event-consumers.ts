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
	WorktreeCleanupTarget,
	WorktreeConsumer,
	WorktreeModuleOptions,
} from "./internal-state.ts";
import { notifyWorktree } from "./notifications.ts";

class Worktree implements WorktreeConsumer {
	private readonly eventHandler: EventHandler;
	private readonly sessionState: SessionState;
	private readonly exec: Exec;
	private readonly changeDirectory: (path: string) => void;
	private context: ExtensionContext | null = null;

	constructor(options: WorktreeModuleOptions) {
		this.eventHandler = options.eventHandler;
		this.sessionState = options.sessionState;
		this.exec = options.exec ?? spawnExec;
		this.changeDirectory = options.changeDirectory ?? process.chdir;
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
		this.context = nextContext;
		await this.initializeSession(nextContext);
	}

	private async consumeToolResult(
		event: { toolName: string; isError: boolean },
		context: ExtensionContext,
	): Promise<void> {
		const isError = event.isError;
		if (isError) return;
		switch (event.toolName) {
			case C.tool.edit:
			case C.tool.write:
			case C.tool.bash:
				await this.refreshStatus(context);
				return;
			default:
				return;
		}
	}

	private publishState(
		moduleState: SessionState["moduleState"]["worktree"],
		gitStatePatch?: Partial<SessionState["gitState"]>,
	): Promise<void> {
		return publishWorktreeState(this.eventHandler, moduleState, gitStatePatch);
	}

	private async refreshStatus(context: ExtensionContext): Promise<void> {
		const dirtyStatus = await inspectDirtyStatus(this.exec, context.cwd);
		if (dirtyStatus === null) return;
		await this.publishState(this.sessionState.moduleState.worktree, {
			hasUncommittedChanges: dirtyStatus,
		});
	}

	private async initializeSession(ctx: ExtensionContext): Promise<void> {
		const project = await inspectProject(this.exec, ctx.cwd);
		const isNotWorktree = !project.isWorktree;
		if (isNotWorktree) {
			const dirtyStatus = await inspectDirtyStatus(this.exec, ctx.cwd);
			if (dirtyStatus === null) return;
			await this.publishState(this.sessionState.moduleState.worktree, {
				hasUncommittedChanges: dirtyStatus,
			});
			return;
		}
		if (project.root === null) return;
		if (project.branch === null) return;
		if (project.mainRoot === null) return;
		const state = await currentWorktreeState(this.exec, ctx.cwd);
		if (state === null) return;
		const moduleState = {
			...this.sessionState.moduleState.worktree,
			initialHead: state.currentHead,
			initialStatus: state.currentStatus,
		};
		await this.publishState(moduleState, {
			branch: project.branch,
			isWorktree: project.isWorktree,
			worktreeRoot: project.root,
			mainRoot: project.mainRoot,
			hasUncommittedChanges: state.currentStatus !== EMPTY,
		});
	}

	deactivate(): void {
		this.context = null;
		void this.publishState({}, {});
	}

	getWorktreeInfo(): { worktreePath: string; branch: string } | null {
		const worktreePath = this.sessionState.gitState.worktreeRoot;
		const branch = this.sessionState.gitState.branch;
		const hasWorktreeInfo =
			typeof worktreePath === "string" && typeof branch === "string";
		if (!hasWorktreeInfo) return null;
		return { worktreePath, branch };
	}

	async hasUncommittedChanges(): Promise<boolean | null> {
		const context = this.context;
		if (context === null) return null;
		return inspectDirtyStatus(this.exec, context.cwd);
	}

	removeWorktree(options: { force: boolean }): Promise<ExitActionResult> {
		const context = this.context;
		if (context === null) return Promise.resolve(FAILED);
		const worktree = currentWorktreeTarget(this.sessionState);
		if (worktree === null) return Promise.resolve(FAILED);
		const sessionId = this.sessionState.session.activeSessionId;
		if (sessionId === null) return Promise.resolve(FAILED);
		return this.executeCleanup(context, sessionId, worktree, options.force);
	}

	private async executeCleanup(
		context: ExtensionContext,
		sessionId: string,
		worktree: WorktreeCleanupTarget,
		force: boolean,
	): Promise<ExitActionResult> {
		const state = await currentWorktreeState(this.exec, worktree.worktreePath);
		const isCurrentWorktreeState = isCurrentWorktree(
			currentWorktreeTarget(this.sessionState),
			worktree,
		);
		if (!isCurrentWorktreeState) {
			await publishSessionNotification(
				this.eventHandler,
				CLEANUP_SKIPPED_SESSION_CHANGE,
				WARNING,
			);
			return FAILED;
		}
		if (state === null) {
			notifyWorktree(context, C.worktree.statusUnavailable, "warning");
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
		worktree: WorktreeCleanupTarget,
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
				this.sessionState.session.activeSessionId === sessionId &&
				isCurrentWorktree(currentWorktreeTarget(this.sessionState), worktree),
			notifySession: (message) =>
				publishSessionNotification(this.eventHandler, message, WARNING),
		});
		const isCurrentAfterCleanup =
			this.sessionState.session.activeSessionId === sessionId &&
			isCurrentWorktree(currentWorktreeTarget(this.sessionState), worktree);
		if (!isCurrentAfterCleanup) return FAILED;
		const worktreeWasRemoved = cleanupState.value;
		if (worktreeWasRemoved) {
			await this.publishState(
				{},
				{
					branch: null,
					isWorktree: false,
					worktreeRoot: null,
					mainRoot: null,
					hasUncommittedChanges: false,
				},
			);
		}
		const cleanupCompleted = result === COMPLETED;
		if (cleanupCompleted) notifyWorktree(context, successMessage);
		return result;
	}
}

function currentWorktreeTarget(
	sessionState: SessionState,
): WorktreeCleanupTarget | null {
	const { worktreeRoot, branch, mainRoot } = sessionState.gitState;
	const hasWorktreePath = typeof worktreeRoot === "string";
	const hasBranch = typeof branch === "string";
	const hasMainRoot = typeof mainRoot === "string";
	if (!hasWorktreePath) return null;
	if (!hasBranch) return null;
	if (!hasMainRoot) return null;
	return {
		worktreePath: worktreeRoot as string,
		branch: branch as string,
		mainRoot: mainRoot as string,
	};
}

export function createWorktreeConsumer(
	options: WorktreeModuleOptions,
): WorktreeConsumer {
	return new Worktree(options);
}
