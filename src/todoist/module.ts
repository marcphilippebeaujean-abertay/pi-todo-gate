import "./commands.ts";
import "./client.ts";
import "./constants.ts";
import "./internal-state.ts";
import "./events.ts";
import "./parsing.ts";
import "./event-consumers.ts";
import "./event-publishers.ts";
import "./notifications.ts";

export { TodoistClient } from "./client.ts";
export * from "./module-state.ts";
export {
	TodoistError,
	TodoistOperationCancelled,
} from "./parsing.ts";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createModuleStatePublisher } from "../event-publishers.ts";
import { register as registerTodoistCommands } from "./commands.ts";
import { completeMergedTask } from "./completion.ts";
import { registerTodoistLifecycleConsumers } from "./event-consumers.ts";
import type {
	TodoistCompletionSnapshot,
	TodoistModuleOptions,
	TodoistSession,
} from "./internal-state.ts";

export type { SessionProject } from "../shared/session-state.ts";

export interface TodoistModule {
	completeMergedTask(
		snapshot: TodoistCompletionSnapshot,
		context: ExtensionContext,
	): Promise<import("../shared/exit-actions.ts").ExitActionResult>;
}

export type { TodoistCompletionSnapshot } from "./internal-state.ts";

class TodoistModuleImpl implements TodoistModule {
	private readonly publishState;

	constructor(private readonly options: TodoistModuleOptions) {
		this.publishState = createModuleStatePublisher(
			this.options.eventHandler,
			"todoist",
		);
		registerTodoistLifecycleConsumers({
			eventHandler: this.options.eventHandler,
			sessionState: this.options.sessionState,
			taskClaimWorker: this.options.taskClaimWorker,
			exec: this.options.exec,
			activateSession: this.activateSession.bind(this),
			registerCommands: (pi) =>
				registerTodoistCommands(
					pi,
					this.options.sessionState,
					this.options.eventHandler,
					this.options.taskRefreshWorker,
					this.options.exec,
				),
		});
	}

	private async activateSession(session: TodoistSession): Promise<void> {
		await this.publishState.publish(
			{
				...this.options.sessionState.moduleState.todoist,
				todoistProjectRef: session.project.todoistProjectRef,
			},
			{ persist: false },
		);
	}

	async completeMergedTask(
		snapshot: TodoistCompletionSnapshot,
		context: ExtensionContext,
	): Promise<import("../shared/exit-actions.ts").ExitActionResult> {
		return completeMergedTask(
			this.options.sessionState,
			this.options.eventHandler,
			context,
			snapshot,
			this.options.exec,
			this.options.createTodoistClient,
		);
	}
}

export function createTodoistModule(
	options: TodoistModuleOptions,
): TodoistModule {
	return new TodoistModuleImpl(options);
}
