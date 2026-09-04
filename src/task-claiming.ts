import type { ActiveSession, ExtensionRuntime } from "./extension-types.ts";
import { runTaskClaim } from "./task-claiming-flow.ts";

const STARTED = true;
const UI_AVAILABLE = true;

export function maybeAnalyzeTaskClaim(
	runtime: ExtensionRuntime,
	session: ActiveSession,
	prompt: string,
): void {
	const hasUI = session.context.hasUI === UI_AVAILABLE;
	const canStart =
		runtime.active === session && session.state.taskRef === undefined;
	const alreadyStarted = session.taskClaimAnalysisStarted;
	const unavailableUI = !hasUI;
	if (unavailableUI) return;
	const unavailableSession = !canStart;
	if (unavailableSession) return;
	if (alreadyStarted) return;
	session.taskClaimAnalysisStarted = STARTED;
	const generation = ++session.taskClaimGeneration;
	void runTaskClaim(runtime, session, prompt, generation);
}
