import "./commands.ts";
import "./client.ts";
import "./constants.ts";
import "./state.ts";
import "./events.ts";
import "./parsing.ts";
import "./event-consumers.ts";
import "./event-publishers.ts";
import "./user-prompts.ts";
import "./notifications.ts";

export * from "./client.ts";
export * from "./commands.ts";
export * from "./event-consumers.ts";
export * from "./event-publishers.ts";
export * from "./events.ts";
export * from "./parsing.ts";
export * from "./state.ts";

import type { EventHandler } from "../shared/events.ts";
import type { ExtensionState, SessionState } from "../state.ts";
import { registerTodoistMergeConsumer } from "./event-consumers.ts";
import type { TodoistModule } from "./state.ts";

export function createTodoistModule(
	eventHandler: EventHandler,
	sessionState: SessionState,
	stateRef: { current: ExtensionState | null },
): TodoistModule {
	const module: TodoistModule = {
		taskClaim: { pending: false, completed: false },
		register() {
			const extensionState = stateRef.current;
			if (extensionState === null) return;
			registerTodoistMergeConsumer({
				...extensionState,
				eventHandler,
				sessionState,
				todoist: module,
			});
		},
	};
	return module;
}
