import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { EXTENSION_CONSTANTS as C } from "../constants.ts";
import type { SharedEvents } from "../shared/events.ts";
import type { PromptQueue } from "../shared/prompt-queue.ts";
import { EXIT_PRESENT_PHASE } from "./constants.ts";
import type { ExitProtocolModule, ExitRequest } from "./state.ts";
import { presentExitActions } from "./user-prompts.ts";

export class ExitProtocolConsumer implements ExitProtocolModule {
	private context: ExtensionContext | null = null;
	private readonly promptQueue: PromptQueue;

	constructor(events: SharedEvents, promptQueue: PromptQueue) {
		this.promptQueue = promptQueue;
		events.on(C.event.prMerged, this.onPrMerged.bind(this), EXIT_PRESENT_PHASE);
	}

	sessionStart(context: ExtensionContext): void {
		this.context = context;
	}

	deactivate(): void {
		this.context = null;
	}

	private onPrMerged(request: ExitRequest): void {
		this.enqueue(request);
	}

	private enqueue(request: ExitRequest): void {
		const context = this.context;
		if (context === null) return;
		void this.promptQueue.enqueue(async (isCurrent) => {
			const isCurrentContext = this.context === context;
			if (!isCurrentContext) return;
			const hasNoActions = request.actions.length === 0;
			if (hasNoActions) return;
			await presentExitActions(context, request.actions, isCurrent);
		});
	}
}
