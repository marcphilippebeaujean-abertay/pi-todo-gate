import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { spawnExec } from "../shared/command.ts";
import { EXTENSION_CONSTANTS as C } from "../shared/constants.ts";
import { inspectProject } from "../shared/project.ts";
import { invalidateOperations } from "../shared/session-operations.ts";
import type { ExtensionState, SessionContext, SessionState } from "../state.ts";
import { applyStatePatch } from "../state.ts";

export function resetTemporarySessionState(runtime: ExtensionState): void {
	runtime.promptQueue.reset();
	runtime.todoist.taskClaim.pending = false;
	runtime.todoist.taskClaim.completed = false;
	runtime.todoist.taskClaim.session = undefined;
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

export async function initializeRemoteOrigin(
	runtime: ExtensionState,
	ctx: ExtensionContext,
	state: SessionContext["state"],
): Promise<SessionContext["state"]> {
	const project = await inspectProject(
		runtime.dependencies.exec ?? spawnExec,
		ctx.cwd,
	);
	const remoteOrigin = project.remoteOrigin ?? undefined;
	const nextState = applyStatePatch(state, { remoteOrigin });
	const hasChanged = state.remoteOrigin !== nextState.remoteOrigin;
	if (hasChanged) appendState(runtime, nextState);
	return nextState;
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
	runtime.footer.deactivate();
	session.context.ui.setFooter(undefined);
}
