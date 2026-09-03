import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { EXTENSION_CONSTANTS as C } from "../constants.ts";
import type {
	EventRequest,
	SharedEventPayloads,
	SharedEvents,
} from "../shared/events.ts";
import { presentExitActions } from "./presenter.ts";

export interface ExitProtocolModule {
	sessionStart(ctx: ExtensionContext): void;
	deactivate(): void;
}

type ExitRequest = EventRequest<SharedEventPayloads[keyof SharedEventPayloads]>;

class ExitProtocol implements ExitProtocolModule {
	private context: ExtensionContext | null = null;
	private operationGeneration = 0;
	private promptQueue = Promise.resolve();

	constructor(events: SharedEvents) {
		events.on(C.event.prMerged, this.onPrMerged.bind(this), C.value.present);
		events.on(
			C.event.sessionWillClose,
			this.enqueueOnQuit.bind(this),
			C.value.present,
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
		const isQuit = request.payload.reason === C.value.quit;
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
		const hasContext = context !== null;
		const isCurrentGeneration = generation === this.operationGeneration;
		const isCurrent = hasContext && isCurrentGeneration;
		const hasActions = request.actions.length > 0;
		const shouldPresent = isCurrent && hasActions;
		if (!shouldPresent) return;
		await presentExitActions(context, request.actions);
	}
}

export function createExitProtocolModule(
	events: SharedEvents,
): ExitProtocolModule {
	return new ExitProtocol(events);
}
