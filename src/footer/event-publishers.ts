import { EXTENSION_CONSTANTS as C } from "../shared/constants.ts";
import type { EventHandler } from "../shared/events.ts";
import type { ModuleState } from "../state.ts";

export function publishFooterState(
	eventHandler: EventHandler,
	moduleState: ModuleState["footer"],
): Promise<void> {
	return eventHandler.moduleStateChangedEvent.emit({
		moduleId: C.module.footer,
		moduleState,
		persist: false,
	});
}
