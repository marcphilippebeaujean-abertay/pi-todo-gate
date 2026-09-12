import "./commands.ts";
import "./constants.ts";
import "./state.ts";
import "./events.ts";
import "./parsing.ts";
import "./git.ts";
import "./event-consumers.ts";
import "./event-publishers.ts";
import "./user-prompts.ts";
import "./notifications.ts";

export * from "./commands.ts";
export { register as registerMergeProtocol } from "./commands.ts";
export * from "./constants.ts";
export * from "./event-consumers.ts";
export * from "./event-publishers.ts";
export * from "./events.ts";
export * from "./git.ts";
export * from "./notifications.ts";
export * from "./parsing.ts";
export * from "./state.ts";
export * from "./user-prompts.ts";

import type { EventHandler } from "../shared/events.ts";
import type { ExtensionState, SessionState } from "../state.ts";
import { register as registerMergeProtocol } from "./commands.ts";
import type { PrModule } from "./state.ts";

export function createPrModule(
	eventHandler: EventHandler,
	sessionState: SessionState,
	stateRef: { current: ExtensionState | null },
): PrModule {
	return {
		register(pi) {
			const extensionState = stateRef.current;
			if (extensionState === null) return;
			registerMergeProtocol(pi, {
				...extensionState,
				eventHandler,
				sessionState,
			});
		},
	};
}
