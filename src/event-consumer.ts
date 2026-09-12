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
import type { SharedEvents, UpdateModuleStateEvent } from "./shared/events.ts";
import type { ExtensionState, SessionState } from "./state.ts";

export function updateModuleState(
	state: SessionState,
	event: UpdateModuleStateEvent,
): void {
	state.moduleState[event.moduleId] = event.moduleState;
}

export function registerModuleStateConsumer(
	events: SharedEvents,
	state: SessionState,
): void {
	events.setupListener(C.event.updateModuleState, (request) => {
		updateModuleState(state, request.payload);
	});
}

export function registerExtensionEventConsumers(
	pi: ExtensionAPI,
	runtime: ExtensionState,
): void {
	pi.on(C.event.sessionStart, handleSessionStart.bind(null, runtime));
	pi.on(C.event.messageEnd, handleMessageEnd.bind(null, runtime));
	pi.on(C.event.beforeAgentStart, handleBeforeAgentStart.bind(null, runtime));
	pi.on(C.event.toolResult, handleToolResult.bind(null, runtime));
	pi.on(C.event.sessionShutdown, handleSessionShutdown.bind(null, runtime));
}
