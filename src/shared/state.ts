import type { PrMergedEvent } from "./events.ts";
import type { ExitAction } from "./exit-actions.ts";

export type SharedEventPayloads = {
	prMerged: PrMergedEvent;
};

export interface EventRequest<T> {
	payload: T;
	readonly actions: readonly ExitAction[];
	addAction(action: ExitAction): void;
}

export type EventListener<T> = (
	request: EventRequest<T>,
) => void | Promise<void>;

export type EventName = keyof SharedEventPayloads;
export type EventPhase = "collect" | "present";
type Listener<T> = { listener: EventListener<T>; phase: EventPhase };
export type AnyListener = Listener<SharedEventPayloads[EventName]>;
export type ListenerMap = Map<EventName, AnyListener[]>;

export type AnyRequest = EventRequest<SharedEventPayloads[EventName]>;

export interface SharedEvents {
	on<K extends EventName>(
		event: K,
		listener: EventListener<SharedEventPayloads[K]>,
		phase?: EventPhase,
	): () => void;
	emit<K extends EventName>(
		event: K,
		payload: SharedEventPayloads[K],
	): Promise<void>;
}
