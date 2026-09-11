import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { SharedEvents } from "../shared/events.ts";
import type { PromptQueue } from "../shared/prompt-queue.ts";

export type {
	ExitAction,
	ExitActionId,
	ExitActionResult,
} from "../shared/exit-actions.ts";
export * from "./state.ts";
export interface ExitProtocolModule {
	sessionStart(ctx: ExtensionContext): void;
	deactivate(): void;
}
export type ExitProtocolFactory = (
	events: SharedEvents,
	promptQueue: PromptQueue,
) => ExitProtocolModule;
