import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type {
	EventRequest,
	SharedEventPayloads,
	SharedEvents,
} from "../shared/events.ts";
import { PromptQueue } from "../shared/prompt-queue.ts";
import { EXIT_PRESENT_PHASE, EXIT_QUIT } from "./constants.ts";
import type { ExitProtocolModule } from "./data.ts";
import { presentExitActions } from "./user-prompts.ts";

type ExitRequest = EventRequest<SharedEventPayloads[keyof SharedEventPayloads]>;

export class ExitProtocolConsumer implements ExitProtocolModule {
	private context: ExtensionContext | null = null;
	private readonly promptQueue: PromptQueue;

	constructor(
		events: SharedEvents,
		promptQueue: PromptQueue = new PromptQueue(),
	) {
		this.promptQueue = promptQueue;
		events.on("prMerged", this.onPrMerged.bind(this), EXIT_PRESENT_PHASE);
		events.on(
			"sessionWillClose",
			this.enqueueOnQuit.bind(this),
			EXIT_PRESENT_PHASE,
		);
	}

	sessionStart(context: ExtensionContext): void {
		this.context = context;
	}

	deactivate(): void {
		this.context = null;
	}

	private enqueueOnQuit(
		request: EventRequest<SharedEventPayloads["sessionWillClose"]>,
	): void {
		const isQuit = request.payload.reason === EXIT_QUIT;
		if (!isQuit) return;
		this.enqueue(request);
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
