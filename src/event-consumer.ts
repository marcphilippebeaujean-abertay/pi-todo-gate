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

function applyModuleState(
	state: SessionState,
	update: ModuleStateChangedEvent,
): void {
	const nextModuleState = structuredClone(update.moduleState);
	const hasGitStatePatch = update.gitStatePatch !== undefined;
	if (!hasGitStatePatch) {
		state.moduleState[update.moduleId] = nextModuleState;
		return;
	}
	const nextGitState = {
		...state.gitState,
		...structuredClone(update.gitStatePatch),
	};
	state.moduleState[update.moduleId] = nextModuleState;
	state.gitState = nextGitState;
}

export function updateModuleState(
	state: SessionState,
	update: ModuleStateChangedEvent,
): void {
	applyModuleState(state, update);
}

export async function applyModuleStateChanged(
	state: SessionState,
	update: ModuleStateChangedEvent,
): Promise<void> {
	applyModuleState(state, update);
}

function cloneSessionState(state: SessionState): SessionState {
	const moduleState = { ...state.moduleState };
	delete moduleState[C.module.application];
	return structuredClone({
		sessionId: state.sessionId,
		gitState: state.gitState,
		moduleState,
	});
}

export function registerModuleStateConsumer(
	events: EventHandler,
	state: SessionState,
): void {
	events.moduleStateChangedEvent.subscribe(async (update) => {
		const previousState = cloneSessionState(state);
		await applyModuleStateChanged(state, update);
		const currentState = cloneSessionState(state);
		await events.sessionStateChangedEvent.emit({
			previousState,
			currentState,
		});
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
