import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	handleBeforeAgentStart,
	handleMessageEnd,
	handleToolResult,
} from "./application/event-handlers.ts";
import {
	handleSessionShutdown,
	handleSessionStart,
} from "./application/session.ts";
import { EXTENSION_CONSTANTS as C } from "./shared/constants.ts";
import type {
	EventHandler,
	ExtensionContext,
	ModuleStateChangedEvent,
	ToolResultEvent,
} from "./shared/events.ts";
import type { ExtensionState, SessionState } from "./state.ts";

export function updateModuleState(
	state: SessionState,
	event: ModuleStateChangedEvent,
): void {
	state.moduleState[event.moduleId] = event.moduleState;
}

export function registerModuleStateConsumer(
	events: EventHandler,
	state: SessionState,
): void {
	events.moduleStateChangedEvent.subscribe((event) => {
		updateModuleState(state, event);
	});
}

export function registerExtensionEventConsumers(
	pi: ExtensionAPI,
	runtime: ExtensionState,
): void {
	pi.on(C.event.sessionStart, handleSessionStart.bind(null, runtime));
	pi.on(C.event.messageEnd, handleMessageEnd.bind(null, runtime));
	pi.on(C.event.beforeAgentStart, handleBeforeAgentStart.bind(null, runtime));
	runtime.eventHandler.toolResultEvent.subscribe(({ event, context }) =>
		handleToolResult(runtime, event, context),
	);
	pi.on(
		C.event.toolResult,
		(event: ToolResultEvent, context: ExtensionContext) =>
			runtime.eventHandler.toolResultEvent.emit({ event, context }),
	);
	pi.on(C.event.sessionShutdown, handleSessionShutdown.bind(null, runtime));
}
