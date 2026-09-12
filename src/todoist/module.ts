import "./commands.ts";
import "./client.ts";
import "./constants.ts";
import "./state.ts";
import "./events.ts";
import "./parsing.ts";
import "./event-consumers.ts";
import "./event-publishers.ts";
import "./user-prompts.ts";
import "./notifications.ts";

export * from "./client.ts";
export * from "./commands.ts";
export * from "./event-consumers.ts";
export * from "./event-publishers.ts";
export * from "./events.ts";
export * from "./parsing.ts";
export * from "./state.ts";

import { completeMergedTask } from "./completion.ts";
import {
	maybeAnalyzeTaskClaim as analyzeTaskClaim,
	registerTodoistMergeConsumer,
} from "./event-consumers.ts";
import type {
	TodoistModule,
	TodoistModuleOptions,
	TodoistRuntime,
	TodoistSession,
} from "./state.ts";

class TodoistModuleImpl implements TodoistModule {
	readonly taskClaim = {
		pending: false,
		completed: false,
		session: undefined as TodoistSession | undefined,
	};
	private registered = false;

	constructor(private readonly options: TodoistModuleOptions) {
		this.options.eventHandler.sessionResetEvent.subscribe(() =>
			this.resetTaskClaim(),
		);
	}

	private resetTaskClaim(): void {
		this.taskClaim.pending = false;
		this.taskClaim.completed = false;
		this.taskClaim.session = undefined;
	}

	private runtime(): TodoistRuntime | null {
		const dependencies = this.options.dependencies ?? {};
		const sessionState = this.options.sessionState;
		const runtime = {
			sessionState,
			getSession: this.options.getSession ?? (() => null),
			todoist: this,
			promptQueue: this.options.promptQueue,
			dependencies,
			eventHandler: this.options.eventHandler,
			appendState: this.options.appendState ?? (() => undefined),
			refreshFooterStatuses:
				this.options.refreshFooterStatuses ?? (() => undefined),
			replaceSessionState:
				this.options.replaceSessionState ??
				((session, state) => {
					session.state = state;
				}),
			completeMergedTask: this.options.completeMergedTask,
		} as TodoistRuntime;
		if (runtime.completeMergedTask === undefined)
			runtime.completeMergedTask = (
				session,
				taskRef,
				snapshot,
				revision,
				generation,
			) =>
				completeMergedTask(
					runtime,
					session,
					session.context,
					taskRef,
					snapshot,
					revision,
					generation,
				);
		return runtime;
	}

	register(): void {
		const alreadyRegistered = this.registered;
		if (alreadyRegistered) return;
		const runtime = this.runtime();
		const hasRuntime = runtime !== null;
		const shouldSkipRegistration = !hasRuntime;
		if (shouldSkipRegistration) return;
		this.registered = true;
		registerTodoistMergeConsumer(runtime);
	}

	maybeAnalyzeTaskClaim(session: TodoistSession, prompt: string): void {
		const runtime = this.runtime();
		const hasRuntime = runtime !== null;
		if (!hasRuntime) return;
		analyzeTaskClaim(runtime, session, prompt);
	}
}

export function createTodoistModule(
	options: TodoistModuleOptions,
): TodoistModule;
export function createTodoistModule(
	options: TodoistModuleOptions,
): TodoistModule {
	return new TodoistModuleImpl(options);
}
