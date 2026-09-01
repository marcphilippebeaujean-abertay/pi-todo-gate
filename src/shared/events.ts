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

type Listener<T> = {
	listener: EventListener<T>;
	phase: "collect" | "present";
};

export interface SharedEvents {
	on<K extends keyof SharedEventPayloads>(
		event: K,
		listener: EventListener<SharedEventPayloads[K]>,
		phase?: "collect" | "present",
	): () => void;
	emit<K extends keyof SharedEventPayloads>(
		event: K,
		payload: SharedEventPayloads[K],
	): Promise<void>;
}

export function createSharedEvents(): SharedEvents {
	const listeners = new Map<
		keyof SharedEventPayloads,
		Array<Listener<SharedEventPayloads[keyof SharedEventPayloads]>>
	>();

	return {
		on(event, listener, phase = "collect") {
			const registered = listeners.get(event) ?? [];
			const entry = { listener, phase } as Listener<
				SharedEventPayloads[keyof SharedEventPayloads]
			>;
			registered.push(entry);
			listeners.set(event, registered);

			return () => {
				const current = listeners.get(event);
				if (!current) return;
				const index = current.indexOf(entry);
				if (index >= 0) current.splice(index, 1);
				if (current.length === 0) listeners.delete(event);
			};
		},
		async emit(event, payload) {
			const actions: ExitAction[] = [];
			const request = {
				payload,
				actions,
				addAction(action: ExitAction) {
					if (!actions.some((existing) => existing.id === action.id))
						actions.push(action);
				},
			} as EventRequest<SharedEventPayloads[keyof SharedEventPayloads]>;
			const registered = [...(listeners.get(event) ?? [])];
			for (const phase of ["collect", "present"] as const) {
				for (const entry of registered) {
					if (entry.phase !== phase) continue;
					try {
						await entry.listener(request);
					} catch {
						// One extension module must not prevent other listeners from running.
					}
				}
			}
		},
	};
}
