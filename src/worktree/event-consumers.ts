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
import { EMPTY, FAILED } from "./constants.ts";
import { publishWorktreeState } from "./event-publishers.ts";
import { cleanupWorktree, currentWorktreeStatus } from "./git.ts";
import type { WorktreeModuleOptions } from "./internal-state.ts";
import { notifyWorktree } from "./notifications.ts";

export class WorktreeConsumer {
	private readonly eventHandler: EventHandler;
	private readonly sessionState: SessionState;
	private readonly exec: Exec;
	private context: ExtensionContext | null = null;
	private uncommittedChanges = false;

	constructor(options: WorktreeModuleOptions) {
		this.eventHandler = options.eventHandler;
		this.sessionState = options.sessionState;
		const dependencies = options.dependencies ?? {};
		this.exec = options.exec ?? dependencies.exec ?? spawnExec;
		this.eventHandler.toolResultEvent.subscribe(({ event, context }) =>
			this.consumeToolResult(event, context),
		);
		this.eventHandler.sessionActivatedEvent.subscribe(({ context }) =>
			this.sessionStart(context),
		);
		this.eventHandler.sessionDeactivatedEvent.subscribe(() =>
			this.deactivate(),
		);
	}

	async sessionStart(nextContext: ExtensionContext): Promise<void> {
		this.context = nextContext;
		await this.initializeSession(nextContext);
	}

	private async consumeToolResult(
		event: { toolName: string; isError: boolean },
		context: ExtensionContext,
	): Promise<void> {
		const isError = event.isError;
		if (isError) return;
		const toolName = event.toolName;
		const isEditTool = toolName === C.tool.edit;
		const isWriteTool = toolName === C.tool.write;
		const isFileMutation = isEditTool || isWriteTool;
		const isBashTool = toolName === C.tool.bash;
		const shouldRefresh = isFileMutation || isBashTool;
		const shouldSkipRefresh = !shouldRefresh;
		if (shouldSkipRefresh) return;
		await this.refreshStatus(context);
	}

	private emitState(gitStatePatch?: Partial<SessionState["gitState"]>): void {
		void publishWorktreeState(this.eventHandler, {}, gitStatePatch);
	}

	private async refreshStatus(context: ExtensionContext): Promise<void> {
		const dirtyStatus = await inspectDirtyStatus(this.exec, context.cwd);
		const hasStatus = dirtyStatus !== null;
		if (!hasStatus) return;
		this.uncommittedChanges = dirtyStatus;
		this.emitState({ hasUncommittedChanges: this.uncommittedChanges });
	}

	private async initializeSession(ctx: ExtensionContext): Promise<void> {
		const project = await inspectProject(this.exec, ctx.cwd);
		const isNotWorktree = !project.isWorktree;
		const projectRoot = project.root;
		if (isNotWorktree) {
			await this.initializeNonWorktree(ctx);
			return;
		}
		if (projectRoot === null) return;
		if (project.branch === null) return;
		if (project.mainRoot === null) return;
		const status = await currentWorktreeStatus(this.exec, ctx.cwd);
		if (status === null) return;
		this.uncommittedChanges = status !== EMPTY;
		this.emitState({
			branch: project.branch,
			isWorktree: project.isWorktree,
			worktreeRoot: project.root,
			mainRoot: project.mainRoot,
			hasUncommittedChanges: this.uncommittedChanges,
		});
	}

	private async initializeNonWorktree(ctx: ExtensionContext): Promise<void> {
		const dirtyStatus = await inspectDirtyStatus(this.exec, ctx.cwd);
		const hasStatus = dirtyStatus !== null;
		if (!hasStatus) return;
		this.uncommittedChanges = dirtyStatus;
		this.emitState({
			hasUncommittedChanges: dirtyStatus,
		});
	}

	deactivate(): void {
		this.context = null;
		this.uncommittedChanges = false;
		void publishWorktreeState(this.eventHandler, {}, {});
	}

	async hasUncommittedChanges(): Promise<boolean | null> {
		const context = this.context;
		if (context === null) return null;
		return inspectDirtyStatus(this.exec, context.cwd);
	}

	removeWorktree(options: { force: boolean }): Promise<ExitActionResult> {
		const context = this.context;
		if (context === null) return Promise.resolve(FAILED);
		return this.executeCleanup(context, options.force);
	}

	private async executeCleanup(
		context: ExtensionContext,
		force: boolean,
	): Promise<ExitActionResult> {
		return cleanupWorktree(this.sessionState, force, {
			exec: this.exec,
			notify: notifyWorktree.bind(null, context),
		});
	}
}
