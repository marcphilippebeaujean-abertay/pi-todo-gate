import { EXTENSION_CONSTANTS as C } from "../shared/constants.ts";
import type { EventHandler, FooterUpdateEvent } from "../shared/events.ts";
import type { SessionState } from "../state.ts";

export function publishFooterState(
	eventHandler: EventHandler,
	moduleState: SessionState["moduleState"]["footer"],
): Promise<void> {
	return eventHandler.moduleStateChangedEvent.emit({
		moduleId: C.module.footer,
		moduleState,
		persist: false,
	});
}

export function publishFooterUpdate(
	eventHandler: EventHandler,
	update: FooterUpdateEvent,
): Promise<void> {
	return eventHandler.footerUpdateEvent.emit(update);
}
