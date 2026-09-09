import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type {
	EventRequest,
	SharedEventPayloads,
	SharedEvents,
} from "../shared/events.ts";
import { EXIT_PRESENT_PHASE, EXIT_QUIT } from "./constants.ts";
import type { ExitProtocolModule } from "./data.ts";
import { presentExitActions } from "./user-prompts.ts";

type ExitRequest = EventRequest<SharedEventPayloads[keyof SharedEventPayloads]>;

export class ExitProtocolConsumer implements ExitProtocolModule {
	private context: ExtensionContext | null = null;
	private operationGeneration = 0;
	private promptQueue = Promise.resolve();

	constructor(events: SharedEvents) {
		events.on("prMerged", this.onPrMerged.bind(this), EXIT_PRESENT_PHASE);
		events.on(
			"sessionWillClose",
			this.enqueueOnQuit.bind(this),
			EXIT_PRESENT_PHASE,
		);
	}

	sessionStart(context: ExtensionContext): void {
		this.operationGeneration += 1;
		this.context = context;
	}

	deactivate(): void {
		this.operationGeneration += 1;
		this.context = null;
	}

	private enqueueOnQuit(
		request: EventRequest<SharedEventPayloads["sessionWillClose"]>,
	): Promise<void> | void {
		const isQuit = request.payload.reason === EXIT_QUIT;
		if (!isQuit) return;
		return this.enqueue(request);
	}

	private onPrMerged(request: ExitRequest): Promise<void> {
		return this.enqueue(request);
	}

	private enqueue(request: ExitRequest): Promise<void> {
		const generation = this.operationGeneration;
		const next = this.promptQueue.then(
			this.present.bind(this, request, generation),
			this.present.bind(this, request, generation),
		);
		this.promptQueue = next.then(this.resetQueue, this.resetQueue);
		return next;
	}

	private resetQueue(): void {}

	private async present(
		request: ExitRequest,
		generation: number,
	): Promise<void> {
		const context = this.context;
		if (context === null) return;
		const isStale = generation !== this.operationGeneration;
		if (isStale) return;
		const hasNoActions = request.actions.length === 0;
		if (hasNoActions) return;
		await presentExitActions(context, request.actions);
	}
}
