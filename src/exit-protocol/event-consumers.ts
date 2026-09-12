import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { EXTENSION_CONSTANTS as C } from "../constants.ts";
import type { PromptQueue } from "../shared/prompt-queue.ts";
import type { SharedEvents } from "../shared/state.ts";
import { EXIT_PRESENT_PHASE } from "./constants.ts";
import { enqueueExitActions } from "./event-publishers.ts";
import type { ExitProtocolModule, ExitRequest } from "./state.ts";

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
		const context = this.context;
		if (context === null) return;
		enqueueExitActions(
			this.promptQueue,
			context,
			request,
			() => this.context === context,
		);
	}
}
