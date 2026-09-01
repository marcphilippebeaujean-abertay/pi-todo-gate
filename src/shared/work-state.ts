import type { WorkState } from "../types.ts";

export function matchesWorkState(
	state: WorkState,
	taskRef: string,
	prUrl: string,
): boolean {
	const hasSameTask = state.taskRef === taskRef;
	const hasSamePr = state.prUrl === prUrl;
	return hasSameTask && hasSamePr;
}
