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
	TodoistModule,
	TodoistModuleOptions,
	TodoistOperations,
	TodoistSession,
} from "./state.ts";

class TodoistModuleImpl implements TodoistModule {
	private readonly pi: TodoistModuleOptions["pi"];
	private readonly getLifecycleEpoch: () => number;
	private currentSession: TodoistSession | null = null;
	readonly taskClaim = {
		pending: false,
		completed: false,
		session: undefined as TodoistSession | undefined,
	};
	private registered = false;

	constructor(private readonly options: TodoistModuleOptions) {
		this.pi = options.pi;
		this.getLifecycleEpoch = options.getLifecycleEpoch ?? (() => 0);
		this.options.eventHandler.sessionActivatedEvent.subscribe(
			({ context, session, lifecycleEpoch }) => {
				const hasSession = session !== undefined;
				if (!hasSession) return;
				const isCurrentContext = session.context === context;
				if (!isCurrentContext) return;
				const activationEpoch = lifecycleEpoch ?? this.getLifecycleEpoch();
				const isCurrentEpoch = activationEpoch === this.getLifecycleEpoch();
				if (!isCurrentEpoch) return;
				this.resetTaskClaim();
				this.currentSession = session;
				void this.syncSessionState(session, activationEpoch);
			},
		);
		this.options.eventHandler.sessionResetEvent.subscribe(() =>
			this.resetTaskClaim(),
		);
		this.options.eventHandler.sessionDeactivatedEvent.subscribe(() => {
			this.currentSession = null;
			this.resetTaskClaim();
		});
	}

	async syncSessionState(
		session: TodoistSession,
		activationEpoch?: number,
	): Promise<void> {
		const hasExplicitEpoch = activationEpoch !== undefined;
		const epoch = activationEpoch ?? this.getLifecycleEpoch();
		const isCurrentSession =
			this.currentSession === session || !hasExplicitEpoch;
		const isCurrentActivation =
			isCurrentSession && epoch === this.getLifecycleEpoch();
		if (!isCurrentActivation) return;
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

	private operations(): TodoistOperations {
		const dependencies = this.options.dependencies ?? {};
		const sessionState = this.options.sessionState;
		const operations = {
			sessionState,
			getSession: () => this.currentSession,
			getLifecycleEpoch: this.getLifecycleEpoch,
			todoist: this,
			promptQueue: this.options.promptQueue,
			dependencies,
			eventHandler: this.options.eventHandler,
			emitState: this.syncSessionState.bind(this),
			appendState: this.appendPersistedState.bind(this),
			refreshFooterStatuses: () => undefined,
			replaceSessionState: this.replaceSessionState.bind(this),
			completeMergedTask: undefined,
		} as TodoistOperations;
		if (operations.completeMergedTask === undefined)
			operations.completeMergedTask = (
				session,
				taskRef,
				snapshot,
				revision,
				generation,
			) =>
				completeMergedTask(
					operations,
					session,
					session.context,
					taskRef,
					snapshot,
					revision,
					generation,
				);
		return operations;
	}

	register(): void {
		const alreadyRegistered = this.registered;
		if (alreadyRegistered) return;
		const operations = this.operations();
		const hasOperations = operations !== null;
		const shouldSkipRegistration = !hasOperations;
		if (shouldSkipRegistration) return;
		this.registered = true;
		registerTodoistMergeConsumer(operations);
	}

	maybeAnalyzeTaskClaim(session: TodoistSession, prompt: string): void {
		const operations = this.operations();
		const hasOperations = operations !== null;
		if (!hasOperations) return;
		analyzeTaskClaim(operations, session, prompt);
	}
}

export function createTodoistModule(
	options: TodoistModuleOptions,
): TodoistModule {
	return new TodoistModuleImpl(options);
}
