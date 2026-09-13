import "./commands.ts";
import "./constants.ts";
import "./state.ts";
import "./events.ts";
import "./event-consumers.ts";
import "./event-publishers.ts";
import "./notifications.ts";
import "./user-prompts.ts";
import { ExitProtocolConsumer } from "./event-consumers.ts";
import type { ExitProtocolModule, ExitProtocolModuleOptions } from "./state.ts";

export type {
	ExitAction,
	ExitActionId,
	ExitActionResult,
} from "../shared/exit-actions.ts";
export * from "./events.ts";
export * from "./state.ts";
export * from "./user-prompts.ts";

export function createExitProtocolModule(
	options: ExitProtocolModuleOptions,
): ExitProtocolModule;
export function createExitProtocolModule(
	options: ExitProtocolModuleOptions,
): ExitProtocolModule {
	return new ExitProtocolConsumer(options);
}
