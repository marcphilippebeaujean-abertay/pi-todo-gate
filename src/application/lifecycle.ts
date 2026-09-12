import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { spawnExec } from "../shared/command.ts";
import { EXTENSION_CONSTANTS as C } from "../shared/constants.ts";
import { inspectProject } from "../shared/project.ts";
import { invalidateOperations } from "../shared/session-operations.ts";
import type { ActiveSession, ExtensionRuntime } from "../state.ts";
import { applyStatePatch } from "../state.ts";

export function resetTemporarySessionState(runtime: ExtensionRuntime): void {
	runtime.promptQueue.reset();
	runtime.taskClaim.pending = false;
	runtime.taskClaim.completed = false;
	runtime.taskClaim.session = undefined;
}

export function replaceSessionState(
	session: ActiveSession,
	nextState: ActiveSession["state"],
): void {
	const hasTaskChanged = session.state.taskRef !== nextState.taskRef;
	const hasPrChanged = session.state.prUrl !== nextState.prUrl;
	const hasWorkIdentityChanged = hasTaskChanged || hasPrChanged;
	if (hasWorkIdentityChanged) session.workRevision += 1;
	session.state = nextState;
}

export function appendState(
	runtime: ExtensionRuntime,
	state: ActiveSession["state"],
	prDiscoveryDisabled?: boolean,
): void {
	const shouldDisablePrDiscovery = prDiscoveryDisabled ?? false;
	const data = shouldDisablePrDiscovery
		? { ...state, prDiscoveryDisabled: true }
		: state;
	runtime.pi.appendEntry(C.entry.state, data);
}

export async function initializeRemoteOrigin(
	runtime: ExtensionRuntime,
	ctx: ExtensionContext,
	state: ActiveSession["state"],
): Promise<ActiveSession["state"]> {
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

export function deactivateSession(
	runtime: ExtensionRuntime,
	session: ActiveSession,
): void {
	invalidateOperations(session);
	runtime.footer.deactivate();
	session.context.ui.setFooter(undefined);
}
