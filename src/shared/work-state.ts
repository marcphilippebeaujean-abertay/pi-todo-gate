import {
	currentSessionContext,
	type ExtensionState,
	type SessionContext,
	type WorkState,
} from "../state.ts";

export type { WorkState } from "../state.ts";

export function isCurrentMerge(
	runtime: ExtensionState,
	session: SessionContext,
	workRevision: number,
	operationGeneration: number,
	taskRef: string | undefined,
	prUrl: string,
): boolean {
	const isActive = currentSessionContext(runtime.sessionState) === session;
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
