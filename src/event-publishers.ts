import type { EventHandler, SessionActivatedEvent } from "./shared/events.ts";

export class RootEventPublisher {
	constructor(private readonly eventHandler: EventHandler) {}

	publishSessionReset(): Promise<void> {
		return this.eventHandler.sessionResetEvent.emit(undefined);
	}

	publishSessionActivated(payload: SessionActivatedEvent): Promise<void> {
		return this.eventHandler.sessionActivatedEvent.emit(payload);
	}

	publishSessionDeactivated(): Promise<void> {
		return this.eventHandler.sessionDeactivatedEvent.emit(undefined);
	}
}
