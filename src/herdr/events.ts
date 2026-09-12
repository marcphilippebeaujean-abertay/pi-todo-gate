import type { ClaimWorkerResult } from "./state.ts";

export interface ClaimCompletedEvent {
	attemptId: number;
	result?: ClaimWorkerResult;
}

export interface ClaimFailedEvent {
	attemptId: number;
	message: string;
	workerFailed: boolean;
}

export type HerdrEventPayloads = {
	claimCompleted: ClaimCompletedEvent;
	claimFailed: ClaimFailedEvent;
};

export type HerdrEventName = keyof HerdrEventPayloads;
export type HerdrEventListener<K extends HerdrEventName> = (
	payload: HerdrEventPayloads[K],
) => void;
export type HerdrEvents = {
	on<K extends HerdrEventName>(
		event: K,
		listener: HerdrEventListener<K>,
	): () => void;
	emit<K extends HerdrEventName>(
		event: K,
		payload: HerdrEventPayloads[K],
	): void;
};
export type AnyListener = HerdrEventListener<HerdrEventName>;
export type ListenerSet = Set<AnyListener>;

export type FooterEventSink = (event: {
	footerType: string;
	isLoading: boolean;
	text: string;
	isVisible: boolean;
}) => void;

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
