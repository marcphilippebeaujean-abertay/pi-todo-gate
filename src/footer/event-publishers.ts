import { EXTENSION_CONSTANTS as C } from "../shared/constants.ts";
import type { EventHandler } from "../shared/events.ts";

export function publishFooterState(
	eventHandler: EventHandler,
	moduleState: Record<string, unknown>,
): Promise<void> {
	return eventHandler.moduleStateChangedEvent.emit({
		moduleId: C.module.footer,
		moduleState,
	});
}
