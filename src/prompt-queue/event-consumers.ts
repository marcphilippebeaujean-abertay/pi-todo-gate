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
		const hasContext = this.context === context;
		if (!hasContext) return false;
		const session = this.session;
		const hasSession = session !== null;
		if (!hasSession) return false;
		const hasMatchingSessionContext = session.context === context;
		if (!hasMatchingSessionContext) return false;
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
		if (shouldQueueTodoist) {
			const snapshot: TodoistCompletionSnapshot = {
				taskRef,
				taskName: this.sessionState.moduleState.todoist.taskName ?? taskRef,
				prUrl,
				workRevision: session.workRevision,
				sessionId,
			};
			void this.queue
				.enqueue((isCurrent) =>
					this.completeTodoist(context, snapshot, isCurrent),
				)
				.catch(() => undefined);
		}
		void this.queue
			.enqueue((isCurrent) => this.presentExit(context, sessionId, isCurrent))
			.catch(() => undefined);
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
		await this.todoist.completeMergedTask(snapshot);
	}

	private async presentExit(
		context: ExtensionContext,
		sessionId: string,
		isQueuedCurrent: () => boolean,
	): Promise<void> {
		const isCurrentBeforePrompt = this.isCurrentJob(
			context,
			sessionId,
			isQueuedCurrent,
		);
		const canPrompt = context.hasUI && isCurrentBeforePrompt;
		if (!canPrompt) return;
		const info = this.worktree.getWorktreeInfo();
		if (info === null) return;
		const confirmed = await confirmRemoveWorktree(
			context,
			info.worktreePath,
			info.branch,
		);
		const isCurrentAfterPrompt = this.isCurrentJob(
			context,
			sessionId,
			isQueuedCurrent,
		);
		const shouldRemove = isCurrentAfterPrompt && confirmed;
		if (!shouldRemove) return;
		await this.removeWorktree(
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
	): Promise<void> {
		const isCurrentBeforeStatus = this.isCurrentJob(
			context,
			sessionId,
			isQueuedCurrent,
		);
		if (!isCurrentBeforeStatus) return;
		const dirty = await this.worktree.hasUncommittedChanges();
		const isCurrentAfterStatus = this.isCurrentJob(
			context,
			sessionId,
			isQueuedCurrent,
		);
		if (!isCurrentAfterStatus) return;
		let force = false;
		const hasDirtyWorktree = dirty === true;
		if (hasDirtyWorktree) {
			force = await confirmDirtyWorktree(context, worktreePath);
			const isCurrentAfterPrompt = this.isCurrentJob(
				context,
				sessionId,
				isQueuedCurrent,
			);
			if (!isCurrentAfterPrompt) return;
		}
		const isCurrentBeforeCapability = this.isCurrentJob(
			context,
			sessionId,
			isQueuedCurrent,
		);
		if (!isCurrentBeforeCapability) return;
		await this.worktree.removeWorktree({ force });
	}
}
