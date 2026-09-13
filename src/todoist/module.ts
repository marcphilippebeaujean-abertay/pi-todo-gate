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

import { EXTENSION_CONSTANTS as C } from "../shared/constants.ts";
import { completeMergedTask } from "./completion.ts";
import {
	maybeAnalyzeTaskClaim as analyzeTaskClaim,
	registerTodoistMergeConsumer,
} from "./event-consumers.ts";
import type {
	TodoistDependencies,
	TodoistModule,
	TodoistModuleOptions,
	TodoistSession,
} from "./state.ts";

class TodoistModuleImpl implements TodoistModule {
	private readonly pi: TodoistModuleOptions["pi"];
	readonly taskClaim = {
		pending: false,
		completed: false,
		session: undefined as TodoistSession | undefined,
	};
	private registered = false;

	constructor(private readonly options: TodoistModuleOptions) {
		this.pi = options.pi;
		this.options.eventHandler.sessionActivatedEvent.subscribe(({ context }) => {
			this.resetTaskClaim();
			const session = this.options.getSession?.();
			const hasSession = session !== undefined && session !== null;
			const isCurrentContext = hasSession && session.context === context;
			const canSync = isCurrentContext && session !== undefined;
			if (!canSync) return;
			void this.syncSessionState(session);
		});
		this.options.eventHandler.sessionResetEvent.subscribe(() =>
			this.resetTaskClaim(),
		);
		this.options.eventHandler.sessionDeactivatedEvent.subscribe(() =>
			this.resetTaskClaim(),
		);
	}

	async syncSessionState(session: TodoistSession): Promise<void> {
		await this.options.eventHandler.moduleStateChangedEvent.emit({
			moduleId: C.module.todoist,
			moduleState: {
				taskRef: session.state.taskRef,
				taskName: session.state.taskName,
				taskUrl: session.state.taskUrl,
				mergeCompletedAt: session.state.mergeCompletedAt,
				todoistCompletionAttemptedAt:
					session.state.todoistCompletionAttemptedAt,
			},
		});
	}

	private resetTaskClaim(): void {
		this.taskClaim.pending = false;
		this.taskClaim.completed = false;
		this.taskClaim.session = undefined;
	}

	private appendPersistedState(
		state: import("../shared/session-state.ts").WorkState,
		prDiscoveryDisabled?: boolean,
	): void {
		const hasPi = this.pi !== undefined;
		if (!hasPi) return;
		const shouldDisableDiscovery = prDiscoveryDisabled ?? false;
		const data = shouldDisableDiscovery
			? { ...state, prDiscoveryDisabled: true }
			: state;
		this.pi.appendEntry(C.entry.state, data);
	}

	private replaceSessionState(
		session: TodoistSession,
		state: import("../shared/session-state.ts").WorkState,
	): void {
		session.state = state;
		session.workRevision += 1;
	}

	private runtime(): TodoistDependencies {
		const dependencies = this.options.dependencies ?? {};
		const sessionState = this.options.sessionState;
		const runtime = {
			sessionState,
			getSession: this.options.getSession ?? (() => null),
			todoist: this,
			promptQueue: this.options.promptQueue,
			dependencies,
			eventHandler: this.options.eventHandler,
			emitState: this.syncSessionState.bind(this),
			appendState: this.appendPersistedState.bind(this),
			refreshFooterStatuses: () => undefined,
			replaceSessionState: this.replaceSessionState.bind(this),
			completeMergedTask: undefined,
		} as TodoistDependencies;
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
