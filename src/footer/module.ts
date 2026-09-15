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
import type { FooterModuleOptions } from "./internal-state.ts";

export * from "./module-state.ts";
export type FooterModule = Record<never, never>;
export function createFooterModule(options: FooterModuleOptions): FooterModule {
	return new FooterEventConsumer(options);
}
