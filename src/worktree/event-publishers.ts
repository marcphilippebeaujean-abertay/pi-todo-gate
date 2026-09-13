import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { EXTENSION_CONSTANTS as C } from "../shared/constants.ts";
import type { EventHandler } from "../shared/events.ts";
import type { GitState, ModuleState } from "../shared/session-state.ts";

export function publishWorktreeState(
	eventHandler: EventHandler,
	moduleState: ModuleState["worktree"],
	gitStatePatch?: Partial<GitState>,
): Promise<void> {
	return eventHandler.moduleStateChangedEvent.emit({
		moduleId: C.module.worktree,
		moduleState,
		persist: false,
		...(gitStatePatch === undefined ? {} : { gitStatePatch }),
	});
}

export function publishWorktreeStatus(
	eventHandler: EventHandler,
	context: ExtensionContext,
	hasUncommittedChanges: boolean,
): Promise<void> {
	return eventHandler.worktreeStatusEvent.emit({
		context,
		hasUncommittedChanges,
	});
}
