import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PromptQueue } from "../prompt-queue.ts";
import { EXTENSION_CONSTANTS as C } from "../shared/constants.ts";
import type { EventHandler, PrMergedEvent } from "../shared/events.ts";
import type { WorktreeModule } from "../worktree/state.ts";
import {
	addWorktreeExitAction,
	createExitRequest,
	enqueueExitActions,
} from "./event-publishers.ts";
import type {
	ExitProtocolModule,
	ExitProtocolModuleOptions,
	ExitRequest,
} from "./state.ts";

export class ExitProtocolConsumer implements ExitProtocolModule {
	private context: ExtensionContext | null = null;
	private readonly promptQueue: PromptQueue;
	private readonly eventHandler: EventHandler;
	private readonly worktree: WorktreeModule | undefined;
	private request: ExitRequest | null = null;

	constructor(options: ExitProtocolModuleOptions) {
		this.promptQueue = options.promptQueue;
		this.eventHandler = options.eventHandler;
		this.worktree = options.worktree;
		this.eventHandler.prMergedEvent.subscribe(this.onPrMerged.bind(this));
		this.eventHandler.sessionResetEvent.subscribe(() => this.deactivate());
		this.eventHandler.sessionDeactivatedEvent.subscribe(() =>
			this.deactivate(),
		);
	}

	sessionStart(context: ExtensionContext): void {
		this.context = context;
		void this.eventHandler.moduleStateChangedEvent.emit({
			moduleId: C.module.exitProtocol,
			moduleState: { active: true },
		});
	}

	deactivate(): void {
		this.context = null;
		this.request = null;
		void this.eventHandler.moduleStateChangedEvent.emit({
			moduleId: C.module.exitProtocol,
			moduleState: { active: false },
		});
	}

	private onPrMerged(_event: PrMergedEvent): void {
		const context = this.context;
		if (context === null) return;
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
