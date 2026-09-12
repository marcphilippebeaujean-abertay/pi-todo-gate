import type {
	BeforeAgentStartEvent,
	BeforeAgentStartEventResult,
	ExtensionContext,
	MessageEndEvent,
	SessionStartEvent,
	ToolResultEvent,
} from "@earendil-works/pi-coding-agent";
import type { ExitAction } from "./exit-actions.ts";

export type {
	BeforeAgentStartEvent,
	ExtensionContext,
	MessageEndEvent,
	SessionStartEvent,
	ToolResultEvent,
};

export type BeforeAgentStartResultEvent = BeforeAgentStartEventResult;
export type ExtensionBeforeAgentStartEvent = BeforeAgentStartEvent;
export type ExtensionBeforeAgentStartResultEvent = BeforeAgentStartEventResult;
export type ExtensionMessageEndEvent = MessageEndEvent;
export type ExtensionSessionStartEvent = SessionStartEvent;
export type ExtensionToolResultEvent = ToolResultEvent;

export type EventCallback<T> = (payload: T) => void | Promise<void>;

export interface Event<T> {
	emit(payload: T): Promise<void>;
	subscribe(callback: EventCallback<T>): () => void;
}

type Subscriber<T> = { callback: EventCallback<T> };

class EventChannel<T> implements Event<T> {
	private readonly subscribers: Subscriber<T>[] = [];

	subscribe(callback: EventCallback<T>): () => void {
		const subscriber = { callback };
		this.subscribers.push(subscriber);
		return this.unsubscribe.bind(this, subscriber);
	}

	private unsubscribe(subscriber: Subscriber<T>): void {
		const index = this.subscribers.indexOf(subscriber);
		const hasIndex = index >= 0;
		if (hasIndex) this.subscribers.splice(index, 1);
	}

	async emit(payload: T): Promise<void> {
		const snapshot = [...this.subscribers];
		for (const subscriber of snapshot) {
			try {
				await subscriber.callback(payload);
			} catch {
				// One extension module must not prevent other listeners from running.
			}
		}
	}
}

export function event<T>(): Event<T> {
	return new EventChannel<T>();
}

export interface ClaimErrorEvent {
	jobType: "Herdr" | "Todoist";
	error: string;
}

export interface ModuleStateChangedEvent {
	moduleId: string;
	moduleState: Record<string, unknown>;
}

export type UpdateModuleStateEvent = ModuleStateChangedEvent;

export interface SessionStateChangedEvent {
	previousState: {
		sessionId: string | null;
		moduleState: Record<string, unknown>;
	};
	currentState: {
		sessionId: string | null;
		moduleState: Record<string, unknown>;
	};
}

export type SessionResetEvent = undefined;
export interface SessionActivatedEvent {
	context: ExtensionContext;
}
export type SessionDeactivatedEvent = undefined;

export interface PrMergedEvent {
	prUrl: string | null;
	taskMarkedAsCompleted: boolean;
}

export interface EventRequest<T> {
	payload: T;
	readonly actions: readonly ExitAction[];
	addAction(action: ExitAction): void;
}

export type PrMergedRequest = EventRequest<PrMergedEvent>;

export interface EventHandler {
	moduleStateChangedEvent: Event<ModuleStateChangedEvent>;
	sessionStateChangedEvent: Event<SessionStateChangedEvent>;
	toolResultEvent: Event<{ event: ToolResultEvent; context: ExtensionContext }>;
	sessionResetEvent: Event<SessionResetEvent>;
	sessionActivatedEvent: Event<SessionActivatedEvent>;
	sessionDeactivatedEvent: Event<SessionDeactivatedEvent>;
	prMergeRequestedEvent: Event<PrMergedRequest>;
	prMergedEvent: Event<PrMergedRequest>;
}

function addAction(actions: ExitAction[], action: ExitAction): void {
	const alreadyAdded = actions.some((existing) => existing.id === action.id);
	if (!alreadyAdded) actions.push(action);
}

export function createPrMergedRequest(payload: PrMergedEvent): PrMergedRequest {
	const actions: ExitAction[] = [];
	return {
		payload,
		actions,
		addAction: addAction.bind(null, actions),
	};
}

export function createSharedEvents(): EventHandler {
	const prMergeRequestedEvent = event<PrMergedRequest>();
	const prMergedEvent = event<PrMergedRequest>();
	return {
		moduleStateChangedEvent: event<ModuleStateChangedEvent>(),
		sessionStateChangedEvent: event<SessionStateChangedEvent>(),
		toolResultEvent: event<{
			event: ToolResultEvent;
			context: ExtensionContext;
		}>(),
		sessionResetEvent: event<SessionResetEvent>(),
		sessionActivatedEvent: event<SessionActivatedEvent>(),
		sessionDeactivatedEvent: event<SessionDeactivatedEvent>(),
		prMergeRequestedEvent: {
			subscribe: prMergeRequestedEvent.subscribe.bind(prMergeRequestedEvent),
			emit: async (request) => {
				await prMergeRequestedEvent.emit(request);
				await prMergedEvent.emit(request);
			},
		},
		prMergedEvent,
	};
}

export const createEventHandler = createSharedEvents;
