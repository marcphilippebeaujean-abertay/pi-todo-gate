import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { EXTENSION_CONSTANTS as C } from "../shared/constants.ts";
import type { EventHandler, PrMergedEvent } from "../shared/events.ts";
import { withLoading } from "../shared/events.ts";
import type { SessionRecord } from "../shared/session-state.ts";
import type { SessionState } from "../state.ts";
import type {
	ExitProtocolState,
	PromptQueueModuleOptions,
	TodoistCompletionSnapshot,
} from "./internal-state.ts";
import type { PromptQueue } from "./queue.ts";
import { confirmExitProtocol } from "./user-prompts.ts";

export class PromptQueueConsumer {
	private readonly eventHandler: EventHandler;
	private readonly sessionState: SessionState;
	private todoist: PromptQueueModuleOptions["todoist"];
	private worktree: PromptQueueModuleOptions["worktree"];
	private readonly queue: PromptQueue;
	private context: ExtensionContext | null = null;
	private session: SessionRecord | null = null;
	private sessionId: string | null = null;

	constructor(options: PromptQueueModuleOptions, queue: PromptQueue) {
		this.eventHandler = options.eventHandler;
		this.sessionState = options.sessionState;
		this.todoist = options.todoist;
		this.worktree = options.worktree;
		this.queue = queue;
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
		const todoistSnapshot = this.todoistSnapshot(
			event,
			taskRef,
			prUrl,
			session,
			sessionId,
		);
		void this.queue
			.enqueue((isCurrent) =>
				this.runExitProtocol(context, sessionId, todoistSnapshot, isCurrent),
			)
			.catch(() => undefined);
	}

	private todoistSnapshot(
		event: PrMergedEvent,
		taskRef: string | undefined,
		prUrl: string | null,
		session: SessionRecord,
		sessionId: string,
	): TodoistCompletionSnapshot | undefined {
		const isTaskMarkedAsCompleted = event.taskMarkedAsCompleted;
		if (isTaskMarkedAsCompleted) return undefined;
		const hasTask = taskRef !== undefined && prUrl !== null;
		const hasNoTask = !hasTask;
		if (hasNoTask) return undefined;
		const hasNoTodoistModule = this.todoist === null;
		if (hasNoTodoistModule) return undefined;
		return {
			taskRef,
			taskName: this.sessionState.moduleState.todoist.taskName ?? taskRef,
			prUrl,
			workRevision: session.workRevision,
			sessionId,
		};
	}

	private async runExitProtocol(
		context: ExtensionContext,
		sessionId: string,
		todoistSnapshot: TodoistCompletionSnapshot | undefined,
		isQueuedCurrent: () => boolean,
	): Promise<void> {
		const state = await this.prepareExitProtocol(
			context,
			sessionId,
			isQueuedCurrent,
		);
		if (state === null) return;
		const worktree = state.worktree;
		const dirty = state.dirty;
		const hasWorktree = worktree !== null;
		const canRemoveWorktree = hasWorktree && dirty !== null;
		const hasTodoistTask = todoistSnapshot !== undefined;
		const hasAction = hasTodoistTask || canRemoveWorktree;
		if (!hasAction) {
			this.shutdownIfNoExitAction(context, hasWorktree);
			return;
		}
		const confirmed = await confirmExitProtocol(context, {
			taskName: todoistSnapshot?.taskName,
			worktreePath: canRemoveWorktree ? worktree.worktreePath : undefined,
			branch: canRemoveWorktree ? worktree.branch : undefined,
			hasUncommittedChanges: dirty === true,
		});
		const isCurrentAfterPrompt = this.isCurrentJob(
			context,
			sessionId,
			isQueuedCurrent,
		);
		const shouldExecute = isCurrentAfterPrompt && confirmed;
		if (!shouldExecute) return;
		const cleanupCompleted = await this.executeExitActions(
			context,
			sessionId,
			todoistSnapshot,
			state,
			canRemoveWorktree,
			isQueuedCurrent,
		);
		const shouldShutdown = cleanupCompleted;
		if (shouldShutdown) context.shutdown();
	}

	private shutdownIfNoExitAction(
		context: ExtensionContext,
		hasWorktree: boolean,
	): void {
		const shouldShutdown = !hasWorktree;
		if (shouldShutdown) context.shutdown();
	}

	private async executeExitActions(
		context: ExtensionContext,
		sessionId: string,
		todoistSnapshot: TodoistCompletionSnapshot | undefined,
		state: ExitProtocolState,
		canRemoveWorktree: boolean,
		isQueuedCurrent: () => boolean,
	): Promise<boolean> {
		const hasTodoistTask = todoistSnapshot !== undefined;
		if (hasTodoistTask) await this.completeTodoist(context, todoistSnapshot);
		if (!canRemoveWorktree) return state.worktree === null;
		const force = state.dirty === true;
		return this.removeWorktree(context, sessionId, isQueuedCurrent, force);
	}

	private async prepareExitProtocol(
		context: ExtensionContext,
		sessionId: string,
		isQueuedCurrent: () => boolean,
	): Promise<ExitProtocolState | null> {
		const isCurrentBeforeStatus = this.isCurrentJob(
			context,
			sessionId,
			isQueuedCurrent,
		);
		const canReadStatus = context.hasUI && isCurrentBeforeStatus;
		if (!canReadStatus) return null;
		const hasWorktreeModule = this.worktree !== null;
		const worktree = hasWorktreeModule
			? (this.worktree?.getWorktreeInfo() ?? null)
			: null;
		const hasWorktree = worktree !== null;
		const dirty = hasWorktree
			? ((await this.worktree?.hasUncommittedChanges()) ?? null)
			: false;
		const isCurrentAfterStatus = this.isCurrentJob(
			context,
			sessionId,
			isQueuedCurrent,
		);
		if (!isCurrentAfterStatus) return null;
		return { worktree, dirty };
	}

	private async completeTodoist(
		context: ExtensionContext,
		snapshot: TodoistCompletionSnapshot,
	): Promise<void> {
		const todoist = this.todoist;
		const hasTodoistModule = todoist !== null;
		if (!hasTodoistModule) return;
		try {
			await this.runWithLoading(
				C.action.task,
				todoist.completeMergedTask.bind(todoist, snapshot, context),
			);
		} catch {
			// Continue cleanup even when Todoist completion fails.
		}
	}

	private async removeWorktree(
		context: ExtensionContext,
		sessionId: string,
		isQueuedCurrent: () => boolean,
		force: boolean,
	): Promise<boolean> {
		const isCurrentBeforeCapability = this.isCurrentJob(
			context,
			sessionId,
			isQueuedCurrent,
		);
		const shouldSkip = !isCurrentBeforeCapability;
		if (shouldSkip) return false;
		const worktree = this.worktree;
		const hasWorktreeModule = worktree !== null;
		if (!hasWorktreeModule) return false;
		const result = await this.runWithLoading(
			C.action.pr,
			worktree.removeWorktree.bind(worktree, { force }),
		);
		return result === "completed";
	}

	private runWithLoading<T>(
		action: string,
		operation: () => Promise<T>,
	): Promise<T> {
		return withLoading(this.eventHandler, action, operation);
	}
}
