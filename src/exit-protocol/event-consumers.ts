import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PromptQueue } from "../prompt-queue.ts";
import type { EventHandler, PrMergedEvent } from "../shared/events.ts";
import type { WorktreeCleanup } from "../worktree/module.ts";
import {
	addWorktreeExitAction,
	createExitRequest,
	enqueueExitActions,
	publishExitProtocolState,
} from "./event-publishers.ts";
import type {
	ExitProtocolModuleOptions,
	ExitRequest,
} from "./internal-state.ts";
export class ExitProtocolConsumer {
	private context: ExtensionContext | null = null;
	private sessionId: string | null = null;
	private readonly promptQueue: PromptQueue;
	private readonly eventHandler: EventHandler;
	private readonly sessionState: ExitProtocolModuleOptions["sessionState"];
	private readonly worktree: WorktreeCleanup | undefined;
	private request: ExitRequest | null = null;

	constructor(options: ExitProtocolModuleOptions) {
		this.promptQueue = options.promptQueue;
		this.eventHandler = options.eventHandler;
		this.sessionState = options.sessionState;
		this.worktree = options.worktree;
		this.eventHandler.prMergedEvent.subscribe(this.onPrMerged.bind(this));
		this.eventHandler.sessionActivatedEvent.subscribe(
			({ context, sessionId }) => {
				this.sessionStart(
					context,
					sessionId ?? this.sessionState.session.activeSessionId ?? "",
				);
			},
		);
		this.eventHandler.sessionDeactivatedEvent.subscribe(() =>
			this.deactivate(),
		);
	}

	sessionStart(context: ExtensionContext, sessionId?: string): void {
		const session = this.sessionState.session;
		const activeSessionId = session.activeSessionId;
		const currentSessionId = sessionId ?? activeSessionId ?? "";
		const hasNoActiveSession = activeSessionId === null;
		const hasCurrentSessionId = activeSessionId === currentSessionId;
		const isCurrentSession = hasNoActiveSession || hasCurrentSessionId;
		if (!isCurrentSession) return;
		this.context = context;
		this.sessionId = currentSessionId || null;
		void publishExitProtocolState(this.eventHandler, true);
	}

	deactivate(): void {
		this.context = null;
		this.sessionId = null;
		this.request = null;
		void publishExitProtocolState(this.eventHandler, false);
	}

	private isCurrentSession(
		context: ExtensionContext,
		sessionId: string,
	): boolean {
		const isCurrentContext = this.context === context;
		const rootSessionId = this.sessionState.session.activeSessionId;
		const hasNoRootSession = rootSessionId === null;
		const hasMatchingSession =
			this.sessionId === sessionId && rootSessionId === sessionId;
		const isCurrentId = hasNoRootSession || hasMatchingSession;
		return isCurrentContext && isCurrentId;
	}

	private onPrMerged(event: PrMergedEvent): void {
		const context = this.context;
		if (context === null) return;
		const sessionId = event.sessionId;
		const isCurrentSession = this.isCurrentSession(context, sessionId);
		if (!isCurrentSession) return;
		const request: ExitRequest = createExitRequest();
		this.request = request;
		addWorktreeExitAction(request, this.worktree);
		const currentRequest = this.request;
		if (currentRequest === null) return;
		enqueueExitActions(this.promptQueue, context, currentRequest, () =>
			this.isCurrentSession(context, sessionId),
		);
	}
}
