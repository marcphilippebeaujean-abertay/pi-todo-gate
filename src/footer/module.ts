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

export class FooterModule {
	constructor(options: FooterModuleOptions) {
		new FooterEventConsumer(options);
	}
}
