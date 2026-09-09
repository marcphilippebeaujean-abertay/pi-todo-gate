import type { ActiveSession, ExtensionRuntime } from "../extension-types.ts";
import type { WorkState } from "../types.ts";

export function isCurrentMerge(
	runtime: ExtensionRuntime,
	session: ActiveSession,
	workRevision: number,
	operationGeneration: number,
	taskRef: string | undefined,
	prUrl: string,
): boolean {
	const isActive = runtime.active === session;
	const hasSameRevision = session.workRevision === workRevision;
	const hasSameGeneration = session.operationGeneration === operationGeneration;
	const hasSameWork = matchesWorkState(session.state, taskRef, prUrl);
	const activeRevision = isActive && hasSameRevision;
	const currentMerge = activeRevision && hasSameGeneration;
	return currentMerge && hasSameWork;
}

export function matchesWorkState(
	state: WorkState,
	taskRef: string | undefined,
	prUrl: string,
): boolean {
	const hasSameTask = state.taskRef === taskRef;
	const hasSamePr = state.prUrl === prUrl;
	return hasSameTask && hasSamePr;
}
