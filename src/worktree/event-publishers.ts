import { EXTENSION_CONSTANTS as C } from "../shared/constants.ts";
import type { EventHandler } from "../shared/events.ts";
import type { SessionState } from "../state.ts";

export function publishWorktreeState(
	eventHandler: EventHandler,
	moduleState: SessionState["moduleState"]["worktree"],
	gitStatePatch?: Partial<SessionState["gitState"]>,
): Promise<void> {
	return eventHandler.moduleStateChangedEvent.emit({
		moduleId: C.module.worktree,
		moduleState,
		persist: false,
		...(gitStatePatch === undefined ? {} : { gitStatePatch }),
	});
}
