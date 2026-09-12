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

import { PromptQueue } from "../prompt-queue.ts";
import type { EventHandler } from "../shared/events.ts";
import { createSessionState, type SessionState } from "../state.ts";
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
		this.options.eventHandler.sessionDeactivatedEvent.subscribe(() =>
			this.resetTaskClaim(),
		);
	}

	private resetTaskClaim(): void {
		this.taskClaim.pending = false;
		this.taskClaim.completed = false;
		this.taskClaim.session = undefined;
	}

	private runtime(): TodoistRuntime | null {
		const current = this.options.stateRef?.current;
		const hasCurrentRuntime = current !== undefined && current !== null;
		if (hasCurrentRuntime)
			return {
				...current,
				todoist: this,
				eventHandler: this.options.eventHandler,
			};
		const dependencies = this.options.dependencies ?? {};
		const sessionState = this.options.sessionState;
		const runtime = {
			sessionState,
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
			completeMergedTask:
				this.options.completeMergedTask ?? (async () => "failed" as const),
		} satisfies TodoistRuntime;
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
	eventHandler: EventHandler,
	sessionState: SessionState,
	stateRef: { readonly current: TodoistRuntime | null },
): TodoistModule;
export function createTodoistModule(
	optionsOrEvents: TodoistModuleOptions | EventHandler,
	sessionState?: SessionState,
	stateRef?: { readonly current: TodoistRuntime | null },
): TodoistModule {
	if ("moduleStateChangedEvent" in optionsOrEvents) {
		return new TodoistModuleImpl({
			promptQueue: stateRef?.current?.promptQueue ?? new PromptQueue(),
			eventHandler: optionsOrEvents,
			sessionState: sessionState ?? createSessionState(),
			stateRef,
		});
	}
	return new TodoistModuleImpl(optionsOrEvents);
}
