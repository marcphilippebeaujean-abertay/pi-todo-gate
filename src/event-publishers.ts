import type {
	EventHandler,
	PiToolRegistrationsBecameAvailableEvent,
	SessionActivatedEvent,
} from "./shared/events.ts";
import { createModuleStateUpdate } from "./shared/module-state-events.ts";
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
			const update = createModuleStateUpdate(moduleId, moduleState, options);
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

	publishSessionNotification(
		message: string,
		level: "info" | "warning",
	): Promise<void> {
		return this.eventHandler.sessionNotificationEvent.emit({ message, level });
	}

	publishPiToolRegistrationsBecameAvailable(
		payload: PiToolRegistrationsBecameAvailableEvent,
	): Promise<void> {
		return this.eventHandler.piToolRegistrationsBecameAvailableEvent.emit(
			payload,
		);
	}
}
