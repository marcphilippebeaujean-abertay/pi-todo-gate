import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import "./commands.ts";
import "./client.ts";
import "./constants.ts";
import "./internal-state.ts";
import "./events.ts";
import "./parsing.ts";
import "./event-consumers.ts";
import "./event-publishers.ts";
import "./notifications.ts";
import { TodoistConsumer } from "./event-consumers.ts";
import type {
	TodoistCompletionSnapshot,
	TodoistModuleOptions,
} from "./internal-state.ts";

export class TodoistModule {
	private readonly consumer: TodoistConsumer;

	constructor(options: TodoistModuleOptions) {
		this.consumer = new TodoistConsumer(options);
	}

	completeMergedTask(
		snapshot: TodoistCompletionSnapshot,
		context: ExtensionContext,
	): Promise<import("../shared/exit-actions.ts").ExitActionResult> {
		return this.consumer.completeMergedTask(snapshot, context);
	}
}
