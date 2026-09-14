import "./commands.ts";
import "./constants.ts";
import "./internal-state.ts";
import "./events.ts";
import "./event-consumers.ts";
import "./event-publishers.ts";
import "./notifications.ts";
import "./user-prompts.ts";
import { ExitProtocolConsumer } from "./event-consumers.ts";
import type { ExitProtocolModuleOptions } from "./internal-state.ts";

export type {
	ExitAction,
	ExitActionId,
	ExitActionResult,
} from "../shared/exit-actions.ts";
export * from "./events.ts";
export * from "./module-state.ts";
export * from "./user-prompts.ts";
export type ExitProtocolModule = Record<never, never>;

export function createExitProtocolModule(
	options: ExitProtocolModuleOptions,
): ExitProtocolModule {
	return new ExitProtocolConsumer(options);
}
