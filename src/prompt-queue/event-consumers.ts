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
import type { ExitAction, PromptQueueModuleOptions } from "./internal-state.ts";
import { PromptQueue } from "./queue.ts";
import {
	confirmDirtyWorktree,
	confirmTodoistCompletion,
	presentExitActions,
	worktreeAction,
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
			if (!isCurrent || session.context !== event.context) return;
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

	private isCurrent(context: ExtensionContext, sessionId: string): boolean {
		return (
			this.context === context &&
			this.session !== null &&
			this.session.context === context &&
			this.sessionId === sessionId &&
			this.sessionState.session.activeSessionId === sessionId
		);
	}

	private onPrMerged(event: PrMergedEvent): void {
		const context = this.context;
		const session = this.session;
		const sessionId = this.sessionId;
		if (context === null || session === null || sessionId === null) return;
		if (!this.isCurrent(context, event.sessionId)) return;
		const taskRef = this.sessionState.moduleState.todoist.taskRef;
		const prUrl = event.prUrl;
		const shouldCompleteTodoist = !event.taskMarkedAsCompleted;
		const hasTask = taskRef !== undefined && prUrl !== null;
		if (shouldCompleteTodoist && hasTask) {
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
		if (
			!context.hasUI ||
			!isQueuedCurrent() ||
			!this.isCurrent(context, snapshot.sessionId)
		)
			return;
		const confirmed = await confirmTodoistCompletion(context, snapshot);
		if (
			!isQueuedCurrent() ||
			!this.isCurrent(context, snapshot.sessionId) ||
			!confirmed
		)
			return;
		if (!isQueuedCurrent() || !this.isCurrent(context, snapshot.sessionId))
			return;
		await this.todoist.completeMergedTask(snapshot);
	}

	private async presentExit(
		context: ExtensionContext,
		sessionId: string,
		isQueuedCurrent: () => boolean,
	): Promise<void> {
		if (
			!context.hasUI ||
			!isQueuedCurrent() ||
			!this.isCurrent(context, sessionId)
		)
			return;
		const info = this.worktree.getWorktreeInfo();
		if (info === null) return;
		const action = worktreeAction(info.worktreePath, info.branch, async () => {
			if (!isQueuedCurrent() || !this.isCurrent(context, sessionId))
				return "failed";
			const dirty = await this.worktree.hasUncommittedChanges();
			if (!isQueuedCurrent() || !this.isCurrent(context, sessionId))
				return "failed";
			let force = false;
			if (dirty === true) {
				force = await confirmDirtyWorktree(context, info.worktreePath);
				if (!isQueuedCurrent() || !this.isCurrent(context, sessionId))
					return "failed";
			}
			if (!isQueuedCurrent() || !this.isCurrent(context, sessionId))
				return "failed";
			return this.worktree.removeWorktree({ force });
		});
		const actions: readonly ExitAction[] = [action];
		await presentExitActions(
			context,
			actions,
			() => isQueuedCurrent() && this.isCurrent(context, sessionId),
		);
	}
}
