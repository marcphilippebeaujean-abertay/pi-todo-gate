import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { EXTENSION_CONSTANTS as C } from "./constants.ts";
import type {
	ActiveSession,
	ExtensionDependencies,
	ExtensionRuntime,
} from "./extension-types.ts";
import { renderPrStatus, renderTodoistTaskStatus } from "./footer/module.ts";
import { invalidateOperations } from "./session-operations.ts";
import { spawnExec } from "./shared/command.ts";
import { TodoistClient } from "./todoist/module.ts";

export function resetTemporarySessionState(runtime: ExtensionRuntime): void {
	runtime.promptQueue.reset();
	runtime.taskClaim.pending = false;
	runtime.taskClaim.completed = false;
	runtime.taskClaim.session = undefined;
}

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
		text: renderTodoistTaskStatus(
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
