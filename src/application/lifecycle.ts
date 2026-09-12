import { EXTENSION_CONSTANTS as C } from "../shared/constants.ts";
import { invalidateOperations } from "../shared/session-operations.ts";
import type { ExtensionState, SessionContext, SessionState } from "../state.ts";

export function resetTemporarySessionState(runtime: ExtensionState): void {
	runtime.promptQueue.reset();
	const resetEvent = runtime.eventHandler.sessionResetEvent;
	const hasResetEvent = resetEvent !== undefined;
	if (hasResetEvent) void resetEvent.emit(undefined);
}

export function replaceSessionState(
	session: SessionContext,
	nextState: SessionContext["state"],
): void {
	const hasTaskChanged = session.state.taskRef !== nextState.taskRef;
	const hasPrChanged = session.state.prUrl !== nextState.prUrl;
	const hasWorkIdentityChanged = hasTaskChanged || hasPrChanged;
	if (hasWorkIdentityChanged) session.workRevision += 1;
	session.state = nextState;
}

export function publishModuleState(
	runtime: ExtensionState,
	moduleId: string,
	moduleState: Record<string, unknown>,
): void {
	void runtime.eventHandler.moduleStateChangedEvent.emit({
		moduleId,
		moduleState,
	});
}

export function appendState(
	runtime: ExtensionState,
	state: SessionContext["state"],
	prDiscoveryDisabled?: boolean,
): void {
	publishModuleState(runtime, C.module.work, { ...state });
	const shouldDisablePrDiscovery = prDiscoveryDisabled ?? false;
	const data = shouldDisablePrDiscovery
		? { ...state, prDiscoveryDisabled: true }
		: state;
	runtime.pi.appendEntry(C.entry.state, data);
}

export function resetSessionState(sessionState: SessionState): void {
	sessionState.sessionId = null;
	sessionState.gitState = {};
	for (const moduleId of Object.keys(sessionState.moduleState)) {
		delete sessionState.moduleState[moduleId];
	}
}

export function deactivateSession(
	runtime: ExtensionState,
	session: SessionContext,
): void {
	invalidateOperations(session);
	const sessionState = runtime.sessionState;
	const isCurrentSession = sessionState.sessionId === session.sessionId;
	if (isCurrentSession) resetSessionState(sessionState);
	runtime.pr.deactivateSession();
	runtime.footer.deactivate();
	session.context.ui.setFooter(undefined);
}
