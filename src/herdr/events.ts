import type {
	HerdrEventListener,
	HerdrEventName,
	HerdrEvents,
} from "./data.ts";

type AnyListener = HerdrEventListener<HerdrEventName>;
type ListenerSet = Set<AnyListener>;

function removeListener(entries: ListenerSet, listener: AnyListener): void {
	entries.delete(listener);
}

export function createHerdrEvents(): HerdrEvents {
	const listeners = new Map<HerdrEventName, ListenerSet>();
	return {
		on(event, listener) {
			const entries = listeners.get(event) ?? new Set<AnyListener>();
			const anyListener = listener as AnyListener;
			entries.add(anyListener);
			listeners.set(event, entries);
			return removeListener.bind(null, entries, anyListener);
		},
		emit(event, payload) {
			const entries = listeners.get(event);
			if (entries === undefined) return;
			for (const listener of entries)
				(listener as HerdrEventListener<typeof event>)(payload);
		},
	};
}
