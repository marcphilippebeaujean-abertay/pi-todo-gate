import "./commands.ts";
import "./constants.ts";
import "./internal-state.ts";
import "./events.ts";
import "./event-consumers.ts";
import "./event-publishers.ts";
import "./notifications.ts";
import "./user-prompts.ts";
import "./footer-rendering.ts";
import { FooterEventConsumer } from "./event-consumers.ts";
import { renderPrStatus, renderTaskStatusCompact } from "./footer-rendering.ts";
import type { FooterModuleOptions } from "./internal-state.ts";

export * from "./events.ts";
export * from "./footer-rendering.ts";
export * from "./module-state.ts";
export type FooterModule = Record<never, never>;
export { renderPrStatus, renderTaskStatusCompact as renderTodoistTaskStatus };

export function createFooterModule(options: FooterModuleOptions): FooterModule {
	return new FooterEventConsumer(options);
}
