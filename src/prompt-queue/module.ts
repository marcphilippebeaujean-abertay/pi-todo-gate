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
import type {
	PromptQueueModule,
	PromptQueueModuleOptions,
} from "./internal-state.ts";
import { PromptQueue } from "./queue.ts";

export type {
	PromptQueueModule,
	PromptQueueModuleOptions,
} from "./internal-state.ts";

export function createPromptQueueModule(
	options: PromptQueueModuleOptions,
): PromptQueueModule {
	const queue = options.queue ?? new PromptQueue();
	const consumer = new PromptQueueConsumer({ ...options, queue });
	register({
		pi: options.pi,
		eventHandler: options.eventHandler,
		sessionState: options.sessionState,
		pr: options.pr,
		getPr: consumer.getPr.bind(consumer),
		queue,
		getContext: consumer.getContext.bind(consumer),
		isCurrent: consumer.isCurrentContext.bind(consumer),
	});
	return consumer;
}
