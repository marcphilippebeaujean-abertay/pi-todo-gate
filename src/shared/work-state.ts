import type { ActiveSession, ExtensionRuntime } from "../extension-types.ts";
import type { WorkState } from "../types.ts";

export function isCurrentMerge(
	runtime: ExtensionRuntime,
	session: ActiveSession,
	workRevision: number,
	taskRef: string,
	prUrl: string,
): boolean {
	const isActive = runtime.active === session;
	const hasSameRevision = session.workRevision === workRevision;
	const hasSameWork = matchesWorkState(session.state, taskRef, prUrl);
	const activeRevision = isActive && hasSameRevision;
	return activeRevision && hasSameWork;
}

export function matchesWorkState(
	state: WorkState,
	taskRef: string,
	prUrl: string,
): boolean {
	const hasSameTask = state.taskRef === taskRef;
	const hasSamePr = state.prUrl === prUrl;
	return hasSameTask && hasSamePr;
}
