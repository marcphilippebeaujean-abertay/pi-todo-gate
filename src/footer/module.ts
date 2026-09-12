import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import "./commands.ts";
import "./constants.ts";
import "./state.ts";
import "./events.ts";
import "./event-consumers.ts";
import "./event-publishers.ts";
import "./notifications.ts";
import "./user-prompts.ts";
import "./footer-rendering.ts";
import { FooterEventConsumer } from "./event-consumers.ts";
import type { FooterModule, FooterModuleDependencies } from "./state.ts";

export * from "./events.ts";
export * from "./footer-rendering.ts";
export { renderTaskStatusCompact as renderTodoistTaskStatus } from "./footer-rendering.ts";
export * from "./state.ts";

export function createFooterModule(
	pi: ExtensionAPI,
	dependencies?: FooterModuleDependencies,
): FooterModule {
	return new FooterEventConsumer(pi, dependencies ?? {});
}
