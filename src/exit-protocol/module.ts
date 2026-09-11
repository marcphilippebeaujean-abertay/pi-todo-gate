import "./commands.ts";
import "./constants.ts";
import "./data.ts";
import "./event-consumers.ts";
import "./event-publishers.ts";
import "./notifications.ts";
import "./user-prompts.ts";
import type { SharedEvents } from "../shared/events.ts";
import { PromptQueue } from "../shared/prompt-queue.ts";
import type { ExitProtocolModule } from "./data.ts";
import { ExitProtocolConsumer } from "./event-consumers.ts";

export type {
	ExitAction,
	ExitActionId,
	ExitActionResult,
} from "../shared/exit-actions.ts";
export * from "./data.ts";
export * from "./user-prompts.ts";

export function createExitProtocolModule(
	events: SharedEvents,
	promptQueue: PromptQueue,
): ExitProtocolModule {
	return new ExitProtocolConsumer(events, promptQueue);
}
