import "./commands.ts";
import "./constants.ts";
import "./internal-state.ts";
import "./events.ts";
import "./event-consumers.ts";
import "./event-publishers.ts";
import "./user-prompts.ts";
import "./notifications.ts";
import { ReviewConsumer } from "./event-consumers.ts";
import type { ReviewModuleOptions } from "./internal-state.ts";

export class ReviewModule {
	constructor(options: ReviewModuleOptions) {
		new ReviewConsumer(options);
	}
}
