import { createPrModule } from "./pr/module.ts";
import type { PrSession } from "./pr/state.ts";
import type { PromptQueue } from "./prompt-queue.ts";
import type { EventHandler } from "./shared/events.ts";
import {
	currentSessionContext,
	type ExtensionState,
	type SessionState,
} from "./state.ts";

export function createRootPrModule(
	promptQueue: PromptQueue,
	eventHandler: EventHandler,
	sessionState: SessionState,
	exec: ExtensionState["dependencies"]["exec"],
	extensionRef: { current: ExtensionState | null },
) {
	return createPrModule({
		promptQueue,
		eventHandler,
		sessionState,
		getSession: () =>
			currentSessionContext(sessionState) as unknown as PrSession | null,
		dependencies: {
			exec,
			appendState: (state, prDiscoveryDisabled) =>
				extensionRef.current?.appendState(
					state as Parameters<ExtensionState["appendState"]>[0],
					prDiscoveryDisabled,
				),
			replaceSessionState: (session, nextState) =>
				extensionRef.current?.replaceSessionState(
					session as Parameters<ExtensionState["replaceSessionState"]>[0],
					nextState as Parameters<ExtensionState["replaceSessionState"]>[1],
				),
			refreshFooterStatuses: (session) =>
				extensionRef.current?.refreshFooterStatuses(
					session as Parameters<ExtensionState["refreshFooterStatuses"]>[0],
				),
		},
	});
}
