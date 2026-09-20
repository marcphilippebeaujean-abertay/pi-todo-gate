import "./commands.ts";
import "./constants.ts";
import "./internal-state.ts";
import "./events.ts";
import "./event-consumers.ts";
import "./event-publishers.ts";
import "./user-prompts.ts";
import "./notifications.ts";
import "./module-state.ts";
import "./queue.ts";
import { register } from "./commands.ts";
import { PromptQueueConsumer } from "./event-consumers.ts";
import type { PromptQueueModuleOptions } from "./internal-state.ts";
import { PromptQueue } from "./queue.ts";

export class PromptQueueModule {
	private readonly consumer: PromptQueueConsumer;

	constructor(options: PromptQueueModuleOptions) {
		const queue = new PromptQueue();
		this.consumer = new PromptQueueConsumer(options, queue);
		register({
			pi: options.pi,
			eventHandler: options.eventHandler,
			sessionState: options.sessionState,
			pr: options.pr,
			getPr: this.consumer.getPr.bind(this.consumer),
			queue,
			getContext: this.consumer.getContext.bind(this.consumer),
			isCurrent: this.consumer.isCurrentContext.bind(this.consumer),
		});
	}

	drain(): Promise<void> {
		return this.consumer.drain();
	}

	getContext() {
		return this.consumer.getContext();
	}
}
