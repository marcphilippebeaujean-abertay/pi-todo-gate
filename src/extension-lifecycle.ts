import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { EXTENSION_CONSTANTS as C } from "./constants.ts";
import type {
	ActiveSession,
	ExtensionDependencies,
	ExtensionRuntime,
} from "./extension-types.ts";
import { renderPrStatus, renderTaskStatus } from "./footer.ts";
import { invalidateOperations } from "./session-operations.ts";
import { applyStatePatch } from "./session-state.ts";
import { spawnExec } from "./shared/command.ts";
import { inspectProject } from "./shared/project.ts";
import { TodoistClient } from "./todoist/client.ts";

export function createClient(
	ctx: ExtensionContext,
	dependencies: ExtensionDependencies,
): TodoistClient {
	const exec = dependencies.exec ?? spawnExec;
	return (
		dependencies.createTodoistClient?.(ctx, exec) ??
		new TodoistClient({
			run: (args) => exec(C.command.todoist, [...args], { cwd: ctx.cwd }),
		})
	);
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
	prDiscoveryDisabled = false,
): void {
	const data = prDiscoveryDisabled
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

export function refreshFooterStatuses(
	runtime: ExtensionRuntime,
	session: ActiveSession,
): void {
	runtime.footer.update({
		footerType: C.status.pr,
		isLoading: false,
		text: renderPrStatus(
			session.state.prUrl,
			session.context.ui.theme,
			session.hasUncommittedChanges,
		),
		isVisible: true,
	});
	runtime.footer.update({
		footerType: C.status.task,
		isLoading: false,
		text: renderTaskStatus(
			session.state.taskUrl,
			session.context.ui.theme,
			session.state.taskName,
		),
		isVisible: true,
	});
}

export function updateWorkingTreeStatus(
	runtime: ExtensionRuntime,
	session: ActiveSession,
	hasUncommittedChanges: boolean,
): void {
	const hasStatusChanged =
		session.hasUncommittedChanges !== hasUncommittedChanges;
	session.hasUncommittedChanges = hasUncommittedChanges;
	if (hasStatusChanged) refreshFooterStatuses(runtime, session);
}

export function deactivateSession(
	runtime: ExtensionRuntime,
	session: ActiveSession,
): void {
	invalidateOperations(session);
	runtime.footer.deactivate();
	session.context.ui.setFooter(undefined);
}
