import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PrModule } from "../pr/module.ts";
import type { EventHandler, PrMergedEvent } from "../shared/events.ts";
import type { SessionRecord } from "../shared/session-state.ts";
import type { SessionState } from "../state.ts";
import type {
	TodoistCompletionSnapshot,
	TodoistModule,
} from "../todoist/module.ts";
import type { WorktreeCleanup } from "../worktree/module.ts";
import type { PromptQueueModuleOptions } from "./internal-state.ts";
import { PromptQueue } from "./queue.ts";
import {
	confirmDirtyWorktree,
	confirmRemoveWorktree,
	confirmTodoistCompletion,
} from "./user-prompts.ts";

export class PromptQueueConsumer {
	private readonly eventHandler: EventHandler;
	private readonly sessionState: SessionState;
	private readonly pr: PrModule;
	private readonly todoist: TodoistModule;
	private readonly worktree: WorktreeCleanup;
	private readonly queue: PromptQueue;
	private context: ExtensionContext | null = null;
	private session: SessionRecord | null = null;
	private sessionId: string | null = null;

	constructor(options: PromptQueueModuleOptions) {
		this.eventHandler = options.eventHandler;
		this.sessionState = options.sessionState;
		this.pr = options.pr;
		this.todoist = options.todoist;
		this.worktree = options.worktree;
		this.queue = options.queue ?? new PromptQueue();
		this.eventHandler.sessionActivatedEvent.subscribe((event) => {
			const session = event.session;
			if (session === undefined) return;
			const isCurrent =
				this.sessionState.session.activeSessionId === event.sessionId;
			const hasMatchingContext = session.context === event.context;
			const isCurrentActivation = isCurrent && hasMatchingContext;
			if (!isCurrentActivation) return;
			this.context = event.context;
			this.session = session;
			this.sessionId = event.sessionId;
		});
		this.eventHandler.sessionDeactivatedEvent.subscribe(() =>
			this.deactivate(),
		);
		this.eventHandler.sessionResetEvent.subscribe(() => this.deactivate());
		this.eventHandler.prMergedEvent.subscribe((event) =>
			this.onPrMerged(event),
		);
	}

	drain(): Promise<void> {
		return this.queue.drain();
	}

	getContext(): ExtensionContext | null {
		return this.context;
	}

	isCurrentContext(context: ExtensionContext): boolean {
		const sessionId = this.sessionId;
		return sessionId !== null && this.isCurrent(context, sessionId);
	}

	private deactivate(): void {
		this.context = null;
		this.session = null;
		this.sessionId = null;
		this.queue.reset();
	}

	private isCurrentJob(
		context: ExtensionContext,
		sessionId: string,
		isQueuedCurrent: () => boolean,
	): boolean {
		const isQueueCurrent = isQueuedCurrent();
		return isQueueCurrent && this.isCurrent(context, sessionId);
	}

	private isCurrent(context: ExtensionContext, sessionId: string): boolean {
		const session = this.session;
		const hasSession = session !== null;
		if (!hasSession) return false;
		const contextSessionId = context.sessionManager.getSessionId();
		const hasMatchingContextSession = contextSessionId === sessionId;
		if (!hasMatchingContextSession) return false;
		const hasMatchingSessionId = this.sessionId === sessionId;
		if (!hasMatchingSessionId) return false;
		return this.sessionState.session.activeSessionId === sessionId;
	}

	private onPrMerged(event: PrMergedEvent): void {
		const context = this.context;
		const session = this.session;
		const sessionId = this.sessionId;
		const hasContextAndSession = context !== null && session !== null;
		const hasActiveSession = hasContextAndSession && sessionId !== null;
		if (!hasActiveSession) return;
		const isCurrentEvent = this.isCurrent(context, event.sessionId);
		if (!isCurrentEvent) return;
		const taskRef = this.sessionState.moduleState.todoist.taskRef;
		const prUrl = event.prUrl;
		const shouldCompleteTodoist = !event.taskMarkedAsCompleted;
		const hasTask = taskRef !== undefined && prUrl !== null;
		const shouldQueueTodoist = shouldCompleteTodoist && hasTask;
		const todoistSnapshot = shouldQueueTodoist
			? ({
					taskRef,
					taskName: this.sessionState.moduleState.todoist.taskName ?? taskRef,
					prUrl,
					workRevision: session.workRevision,
					sessionId,
				} satisfies TodoistCompletionSnapshot)
			: undefined;
		void this.queue
			.enqueue((isCurrent) =>
				this.runExitProtocol(context, sessionId, todoistSnapshot, isCurrent),
			)
			.catch(() => undefined);
	}

	private async runExitProtocol(
		context: ExtensionContext,
		sessionId: string,
		todoistSnapshot: TodoistCompletionSnapshot | undefined,
		isQueuedCurrent: () => boolean,
	): Promise<void> {
		if (todoistSnapshot !== undefined)
			await this.completeTodoist(context, todoistSnapshot, isQueuedCurrent);
		const cleanupCompleted = await this.presentExit(
			context,
			sessionId,
			isQueuedCurrent,
		);
		if (cleanupCompleted) context.shutdown();
	}

	private async completeTodoist(
		context: ExtensionContext,
		snapshot: TodoistCompletionSnapshot,
		isQueuedCurrent: () => boolean,
	): Promise<void> {
		const isCurrentBeforePrompt = this.isCurrentJob(
			context,
			snapshot.sessionId,
			isQueuedCurrent,
		);
		const canPrompt = context.hasUI && isCurrentBeforePrompt;
		if (!canPrompt) return;
		const confirmed = await confirmTodoistCompletion(context, snapshot);
		const isCurrentAfterPrompt = this.isCurrentJob(
			context,
			snapshot.sessionId,
			isQueuedCurrent,
		);
		const shouldComplete = isCurrentAfterPrompt && confirmed;
		if (!shouldComplete) return;
		const isCurrentBeforeCapability = this.isCurrentJob(
			context,
			snapshot.sessionId,
			isQueuedCurrent,
		);
		if (!isCurrentBeforeCapability) return;
		try {
			await this.todoist.completeMergedTask(snapshot);
		} catch {
			return;
		}
	}

	private async presentExit(
		context: ExtensionContext,
		sessionId: string,
		isQueuedCurrent: () => boolean,
	): Promise<boolean> {
		const isCurrentBeforePrompt = this.isCurrentJob(
			context,
			sessionId,
			isQueuedCurrent,
		);
		const canPrompt = context.hasUI && isCurrentBeforePrompt;
		if (!canPrompt) return false;
		const info = this.worktree.getWorktreeInfo();
		if (info === null) return true;
		const dirty = await this.worktree.hasUncommittedChanges();
		const isCurrentAfterStatus = this.isCurrentJob(
			context,
			sessionId,
			isQueuedCurrent,
		);
		const hasUnavailableStatus = dirty === null;
		const canContinue = isCurrentAfterStatus && !hasUnavailableStatus;
		if (!canContinue) return false;
		const confirmed = await confirmRemoveWorktree(
			context,
			info.worktreePath,
			info.branch,
			dirty,
		);
		const isCurrentAfterPrompt = this.isCurrentJob(
			context,
			sessionId,
			isQueuedCurrent,
		);
		const shouldRemove = isCurrentAfterPrompt && confirmed;
		if (!shouldRemove) return false;
		return this.removeWorktree(
			context,
			sessionId,
			isQueuedCurrent,
			info.worktreePath,
		);
	}

	private async removeWorktree(
		context: ExtensionContext,
		sessionId: string,
		isQueuedCurrent: () => boolean,
		worktreePath: string,
	): Promise<boolean> {
		const isCurrentBeforeStatus = this.isCurrentJob(
			context,
			sessionId,
			isQueuedCurrent,
		);
		if (!isCurrentBeforeStatus) return false;
		const dirty = await this.worktree.hasUncommittedChanges();
		const isCurrentAfterStatus = this.isCurrentJob(
			context,
			sessionId,
			isQueuedCurrent,
		);
		const hasUnavailableStatus = dirty === null;
		const canContinue = isCurrentAfterStatus && !hasUnavailableStatus;
		if (!canContinue) return false;
		let force = false;
		const hasDirtyWorktree = dirty === true;
		if (hasDirtyWorktree) {
			force = await confirmDirtyWorktree(context, worktreePath);
			const isCurrentAfterPrompt = this.isCurrentJob(
				context,
				sessionId,
				isQueuedCurrent,
			);
			if (!isCurrentAfterPrompt) return false;
		}
		const isCurrentBeforeCapability = this.isCurrentJob(
			context,
			sessionId,
			isQueuedCurrent,
		);
		if (!isCurrentBeforeCapability) return false;
		const result = await this.worktree.removeWorktree({ force });
		return result === "completed";
	}
}
