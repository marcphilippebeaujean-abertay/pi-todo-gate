import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { EXTENSION_CONSTANTS as C } from "../shared/constants.ts";
import type {
	EventHandler,
	ModuleStateChangedEvent,
} from "../shared/events.ts";

export function publishWorktreeState(
	eventHandler: EventHandler,
	moduleState: Record<string, unknown>,
	gitStatePatch?: ModuleStateChangedEvent["gitStatePatch"],
): Promise<void> {
	return eventHandler.moduleStateChangedEvent.emit({
		moduleId: C.module.worktree,
		moduleState,
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
