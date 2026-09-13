import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PromptQueue } from "../prompt-queue.ts";
import type { EventHandler, PrMergedEvent } from "../shared/events.ts";
import type { WorktreeModule } from "../worktree/state.ts";
import {
	addWorktreeExitAction,
	createExitRequest,
	enqueueExitActions,
	publishExitProtocolState,
} from "./event-publishers.ts";
import type {
	ExitProtocolModule,
	ExitProtocolModuleOptions,
	ExitRequest,
} from "./state.ts";

export class ExitProtocolConsumer implements ExitProtocolModule {
	private context: ExtensionContext | null = null;
	private sessionId: string | null = null;
	private lifecycleEpoch = 0;
	private readonly promptQueue: PromptQueue;
	private readonly eventHandler: EventHandler;
	private readonly getLifecycleEpoch: () => number;
	private readonly sessionState: ExitProtocolModuleOptions["sessionState"];
	private readonly worktree: WorktreeModule | undefined;
	private request: ExitRequest | null = null;

	constructor(options: ExitProtocolModuleOptions) {
		this.promptQueue = options.promptQueue;
		this.eventHandler = options.eventHandler;
		this.getLifecycleEpoch = options.getLifecycleEpoch ?? (() => 0);
		this.sessionState = options.sessionState;
		this.worktree = options.worktree;
		this.eventHandler.prMergedEvent.subscribe(this.onPrMerged.bind(this));
		this.eventHandler.sessionActivatedEvent.subscribe(
			({ context, lifecycleEpoch }) => {
				const activationEpoch = lifecycleEpoch ?? this.getLifecycleEpoch();
				const isCurrentEpoch = activationEpoch === this.getLifecycleEpoch();
				if (!isCurrentEpoch) return;
				this.sessionStart(
					context,
					activationEpoch,
					this.sessionState.session.activeSessionId ?? undefined,
				);
			},
		);
		this.eventHandler.sessionDeactivatedEvent.subscribe(() =>
			this.deactivate(),
		);
	}

	sessionStart(
		context: ExtensionContext,
		activationEpoch?: number,
		sessionId?: string,
	): void {
		const epoch = activationEpoch ?? this.getLifecycleEpoch();
		const isCurrentEpoch = epoch === this.getLifecycleEpoch();
		if (!isCurrentEpoch) return;
		this.context = context;
		this.sessionId = sessionId ?? null;
		this.lifecycleEpoch = epoch;
		const isCurrentActivation =
			this.context === context && epoch === this.getLifecycleEpoch();
		if (!isCurrentActivation) return;
		void publishExitProtocolState(this.eventHandler, true);
	}

	deactivate(): void {
		this.context = null;
		this.sessionId = null;
		this.request = null;
		void publishExitProtocolState(this.eventHandler, false);
	}

	private onPrMerged(event: PrMergedEvent): void {
		const context = this.context;
		if (context === null) return;
		const activeSessionId = this.sessionId;
		const isCurrentSession =
			activeSessionId === null || activeSessionId === event.sessionId;
		const isCurrentEpoch = event.lifecycleEpoch === this.lifecycleEpoch;
		const canEnqueue = isCurrentSession && isCurrentEpoch;
		if (!canEnqueue) return;
		const request: ExitRequest = createExitRequest();
		this.request = request;
		addWorktreeExitAction(request, this.worktree);
		const currentRequest = this.request;
		if (currentRequest === null) return;
		enqueueExitActions(
			this.promptQueue,
			context,
			currentRequest,
			() => this.context === context,
		);
	}
}
