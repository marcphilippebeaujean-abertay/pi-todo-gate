import type {
	BeforeAgentStartEvent,
	BeforeAgentStartEventResult,
	ExtensionAPI,
	ExtensionContext,
	MessageEndEvent,
	SessionStartEvent,
	ToolResultEvent,
} from "@earendil-works/pi-coding-agent";
import type {
	GitState,
	ModuleId,
	ModuleState,
	SessionStateSnapshot,
} from "../state.ts";
import type { SessionRecord } from "./session-state.ts";

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
				const result = subscriber.callback(payload);
				if (result instanceof Promise) await result;
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

export interface FooterUpdateEvent {
	footerType: string;
	text: string;
	isVisible: boolean;
}

export interface FooterLoadingEvent {
	footerType: string;
	isLoading: boolean;
}

export type ModuleStateChangedEvent = {
	[K in ModuleId]: {
		moduleId: K;
		moduleState: ModuleState[K];
		persist: boolean;
		gitStatePatch?: Partial<GitState>;
	};
}[ModuleId];

export type ModuleStateUpdate = ModuleStateChangedEvent;

export type UpdateModuleStateEvent = ModuleStateChangedEvent;

export interface SessionStateChangedEvent {
	previousState: SessionStateSnapshot;
	currentState: SessionStateSnapshot;
}

export type SessionResetEvent = undefined;
export interface SessionActivatedEvent {
	context: ExtensionContext;
	sessionId: string;
	previousSessionFile?: string;
	session?: SessionRecord;
}
export type SessionDeactivatedEvent = undefined;

export interface InitialPrDiscoveryEvent {
	branch: readonly unknown[];
	sessionId: string;
}

export interface MessageEndEventPayload {
	event: MessageEndEvent;
}

export interface BeforeAgentStartEventPayload {
	event: BeforeAgentStartEvent;
	context: ExtensionContext;
	session: SessionRecord;
	sessionId: string;
	messages: string[];
}

export interface PrMergedEvent {
	prUrl: string | null;
	taskMarkedAsCompleted: boolean;
	sessionId: string;
}

export interface PiToolRegistrationsBecameAvailableEvent {
	pi: ExtensionAPI;
}

export interface EventHandler {
	moduleStateChangedEvent: Event<ModuleStateChangedEvent>;
	footerUpdateEvent: Event<FooterUpdateEvent>;
	footerLoadingEvent: Event<FooterLoadingEvent>;
	sessionStateChangedEvent: Event<SessionStateChangedEvent>;
	toolResultEvent: Event<{ event: ToolResultEvent; context: ExtensionContext }>;
	sessionResetEvent: Event<SessionResetEvent>;
	sessionActivatedEvent: Event<SessionActivatedEvent>;
	sessionDeactivatedEvent: Event<SessionDeactivatedEvent>;
	prMergedEvent: Event<PrMergedEvent>;
	initialPrDiscoveryEvent: Event<InitialPrDiscoveryEvent>;
	messageEndEvent: Event<MessageEndEventPayload>;
	beforeAgentStartEvent: Event<BeforeAgentStartEventPayload>;
	piToolRegistrationsBecameAvailableEvent: Event<PiToolRegistrationsBecameAvailableEvent>;
}

export async function withLoading<T>(
	eventHandler: EventHandler,
	footerType: string,
	operation: () => Promise<T>,
	onFinally?: () => void | Promise<void>,
): Promise<T> {
	await eventHandler.footerLoadingEvent.emit({
		footerType,
		isLoading: true,
	});
	try {
		return await operation();
	} finally {
		try {
			await onFinally?.();
		} finally {
			await eventHandler.footerLoadingEvent.emit({
				footerType,
				isLoading: false,
			});
		}
	}
}

export function createSharedEvents(): EventHandler {
	const prMergedEvent = event<PrMergedEvent>();
	return {
		moduleStateChangedEvent: event<ModuleStateChangedEvent>(),
		footerUpdateEvent: event<FooterUpdateEvent>(),
		footerLoadingEvent: event<FooterLoadingEvent>(),
		sessionStateChangedEvent: event<SessionStateChangedEvent>(),
		toolResultEvent: event<{
			event: ToolResultEvent;
			context: ExtensionContext;
		}>(),
		sessionResetEvent: event<SessionResetEvent>(),
		sessionActivatedEvent: event<SessionActivatedEvent>(),
		sessionDeactivatedEvent: event<SessionDeactivatedEvent>(),
		prMergedEvent,
		initialPrDiscoveryEvent: event<InitialPrDiscoveryEvent>(),
		messageEndEvent: event<MessageEndEventPayload>(),
		beforeAgentStartEvent: event<BeforeAgentStartEventPayload>(),
		piToolRegistrationsBecameAvailableEvent:
			event<PiToolRegistrationsBecameAvailableEvent>(),
	};
}

export const createEventHandler = createSharedEvents;
