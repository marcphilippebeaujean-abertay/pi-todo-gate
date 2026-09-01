import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { EXTENSION_CONSTANTS as C } from "./constants.ts";
import type {
	ActiveSession,
	ExtensionDependencies,
	ExtensionRuntime,
} from "./extension-types.ts";
import { renderPrStatus, renderTaskStatus } from "./footer.ts";
import { spawnExec } from "./git.ts";
import { sessionTaskPath } from "./pi-tasks-sync.ts";
import { TodoistClient } from "./todoist.ts";

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

export function taskPath(session: ActiveSession): string {
	return sessionTaskPath(
		session.context.cwd,
		session.context.sessionManager.getSessionId(),
	);
}

export function refreshFooterStatuses(session: ActiveSession): void {
	session.context.ui.setStatus(
		C.status.pr,
		renderPrStatus(session.state.prUrl, session.context.ui.theme),
	);
	session.context.ui.setStatus(
		C.status.task,
		renderTaskStatus(
			session.state.taskUrl,
			session.context.ui.theme,
			session.state.taskName,
		),
	);
}

export function clearFooterStatuses(session: ActiveSession): void {
	session.context.ui.setStatus(C.status.pr, undefined);
	session.context.ui.setStatus(C.status.task, undefined);
}

export function cancelScheduledSync(session: ActiveSession): void {
	session.syncGeneration += 1;
	const hasScheduledSync = session.syncTimer !== undefined;
	if (!hasScheduledSync) return;
	clearTimeout(session.syncTimer);
	session.syncTimer = undefined;
}

export function deactivateSession(session: ActiveSession): void {
	cancelScheduledSync(session);
	clearFooterStatuses(session);
	session.context.ui.setFooter(undefined);
}

export function isCurrentSync(
	active: ActiveSession | null,
	session: ActiveSession,
	generation: number,
): boolean {
	const isDifferentSession = active !== session;
	if (isDifferentSession) return false;
	const isCurrentGeneration = generation === session.syncGeneration;
	if (!isCurrentGeneration) return false;
	return session.syncAvailable;
}
