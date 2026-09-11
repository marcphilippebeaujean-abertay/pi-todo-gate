import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import "./commands.ts";
import "./constants.ts";
import "./data.ts";
import "./event-consumers.ts";
import "./event-publishers.ts";
import "./notifications.ts";
import "./user-prompts.ts";
import "./footer-rendering.ts";
import type { FooterModule, FooterModuleDependencies } from "./data.ts";
import { FooterEventConsumer } from "./event-consumers.ts";

export type {
	FooterEventSink,
	FooterModule,
	FooterModuleDependencies,
	FooterState,
	FooterUpdate,
} from "./data.ts";
export * from "./data.ts";
export * from "./footer-rendering.ts";
export { renderTaskStatusCompact as renderTodoistTaskStatus } from "./footer-rendering.ts";

export function createFooterModule(
	pi: ExtensionAPI,
	dependencies?: FooterModuleDependencies,
): FooterModule {
	return new FooterEventConsumer(pi, dependencies ?? {});
}
