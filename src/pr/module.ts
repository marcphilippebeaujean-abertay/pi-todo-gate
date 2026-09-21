import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import "./commands.ts";
import "./constants.ts";
import "./events.ts";
import "./event-publishers.ts";
import "./git.ts";
import "./notifications.ts";
import "./parsing.ts";
import "./user-prompts.ts";
import "./state-tool.ts";
import { PrConsumer } from "./event-consumers.ts";
import type { PrModuleOptions } from "./internal-state.ts";

export class PrModule {
	private readonly consumer: PrConsumer;

	constructor(options: PrModuleOptions) {
		this.consumer = new PrConsumer(options);
	}

	private persistPrIfAvailable(text: string): Promise<void> {
		return this.consumer.persistPrIfAvailable(text);
	}

	mergeActivePr(context: ExtensionContext): Promise<boolean> {
		return this.consumer.mergeActivePr(context);
	}
}
