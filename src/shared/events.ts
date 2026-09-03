import { EXTENSION_CONSTANTS as C } from "../constants.ts";
import type { ExitAction } from "../exit-protocol/types.ts";

export type ShutdownReason = "quit" | "new" | "resume" | "fork" | "reload";

export interface SharedEventPayloads {
	prMerged: { prUrl: string };
	sessionWillClose: { reason: ShutdownReason };
}

export interface EventRequest<T> {
	readonly payload: T;
	readonly actions: readonly ExitAction[];
	addAction(action: ExitAction): void;
}

export type EventListener<T> = (
	request: EventRequest<T>,
) => void | Promise<void>;

type EventName = keyof SharedEventPayloads;
type EventPhase = "collect" | "present";
type Listener<T> = { listener: EventListener<T>; phase: EventPhase };
type AnyListener = Listener<SharedEventPayloads[EventName]>;
type ListenerMap = Map<EventName, AnyListener[]>;

type AnyRequest = EventRequest<SharedEventPayloads[EventName]>;

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

function addUniqueAction(actions: ExitAction[], action: ExitAction): void {
	const alreadyAdded = actions.some((existing) => existing.id === action.id);
	if (!alreadyAdded) actions.push(action);
}

function createRequest(payload: SharedEventPayloads[EventName]): AnyRequest {
	const actions: ExitAction[] = [];
	return {
		payload,
		actions,
		addAction: addUniqueAction.bind(null, actions),
	} as AnyRequest;
}

function removeListener(
	listeners: ListenerMap,
	event: EventName,
	entry: AnyListener,
): void {
	const current = listeners.get(event);
	const hasCurrent = current !== undefined;
	if (!hasCurrent) return;
	const index = current.indexOf(entry);
	const hasIndex = index >= 0;
	if (hasIndex) current.splice(index, 1);
	const isEmpty = current.length === 0;
	if (isEmpty) listeners.delete(event);
}

function registerListener(
	listeners: ListenerMap,
	event: EventName,
	entry: AnyListener,
): () => void {
	const registered = listeners.get(event) ?? [];
	registered.push(entry);
	listeners.set(event, registered);
	return removeListener.bind(null, listeners, event, entry);
}

async function emitPhase(
	entries: readonly AnyListener[],
	phase: EventPhase,
	request: AnyRequest,
): Promise<void> {
	for (const entry of entries) {
		const isCurrentPhase = entry.phase === phase;
		if (!isCurrentPhase) continue;
		try {
			await entry.listener(request);
		} catch {
			// One extension module must not prevent other listeners from running.
		}
	}
}

export function createSharedEvents(): SharedEvents {
	const listeners: ListenerMap = new Map();
	return {
		on(event, listener, phase = C.value.collect as EventPhase) {
			const entry: AnyListener = {
				listener: listener as EventListener<SharedEventPayloads[EventName]>,
				phase,
			};
			return registerListener(listeners, event, entry);
		},
		emit: async (event, payload) => {
			const request = createRequest(payload);
			const registered = [...(listeners.get(event) ?? [])];
			await emitPhase(registered, C.value.collect as EventPhase, request);
			await emitPhase(registered, C.value.present as EventPhase, request);
		},
	};
}
