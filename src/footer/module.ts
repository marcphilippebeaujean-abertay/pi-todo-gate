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
import { renderPrStatus, renderTaskStatusCompact } from "./footer-rendering.ts";
import type { FooterModule, FooterModuleOptions } from "./state.ts";

export * from "./events.ts";
export * from "./footer-rendering.ts";
export * from "./state.ts";
export { renderPrStatus, renderTaskStatusCompact as renderTodoistTaskStatus };

export function createFooterModule(options: FooterModuleOptions): FooterModule {
	return new FooterEventConsumer(options);
}
