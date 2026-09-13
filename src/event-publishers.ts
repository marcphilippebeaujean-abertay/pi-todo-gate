import type {
	EventHandler,
	ModuleStateChangedEvent,
	PiToolRegistrationsBecameAvailableEvent,
	SessionActivatedEvent,
} from "./shared/events.ts";
import type { GitState, ModuleId, ModuleState } from "./state.ts";

export interface ModuleStatePublisher<K extends ModuleId> {
	publish(
		moduleState: ModuleState[K],
		options: {
			persist: boolean;
			gitStatePatch?: Partial<GitState>;
		},
	): Promise<void>;
}

export function createModuleStatePublisher<K extends ModuleId>(
	eventHandler: EventHandler,
	moduleId: K,
): ModuleStatePublisher<K> {
	return {
		publish(moduleState, options) {
			const update: ModuleStateChangedEvent = {
				moduleId,
				moduleState,
				persist: options.persist,
				...(options.gitStatePatch === undefined
					? {}
					: { gitStatePatch: options.gitStatePatch }),
			} as ModuleStateChangedEvent;
			return eventHandler.moduleStateChangedEvent.emit(update);
		},
	};
}

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

	publishPiToolRegistrationsBecameAvailable(
		payload: PiToolRegistrationsBecameAvailableEvent,
	): Promise<void> {
		return this.eventHandler.piToolRegistrationsBecameAvailableEvent.emit(
			payload,
		);
	}
}
