import type { PromptQueue } from "../prompt-queue.ts";
import type { SessionState } from "../state.ts";
import type { EventHandler } from "./events.ts";

export interface ModuleContext {
	readonly promptQueue: PromptQueue;
	readonly eventHandler: EventHandler;
	readonly sessionState: SessionState;
}
