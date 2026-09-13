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

import { createModuleStatePublisher } from "../event-publishers.ts";
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
	TodoistState,
	TodoistStateUpdateOptions,
} from "./state.ts";

class TodoistModuleImpl implements TodoistModule {
	private readonly getLifecycleEpoch: () => number;
	private readonly publishState;
	private currentSession: TodoistSession | null = null;
	readonly taskClaim = {
		pending: false,
		completed: false,
		session: undefined as TodoistSession | undefined,
	};
	private registered = false;

	constructor(private readonly options: TodoistModuleOptions) {
		this.getLifecycleEpoch = options.getLifecycleEpoch ?? (() => 0);
		this.publishState = createModuleStatePublisher(
			this.options.eventHandler,
			C.module.todoist,
		);
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
		await this.publishState.publish(
			this.options.sessionState.moduleState.todoist,
			{ persist: false },
		);
	}

	private resetTaskClaim(): void {
		this.taskClaim.pending = false;
		this.taskClaim.completed = false;
		this.taskClaim.session = undefined;
	}

	updateState(
		state: TodoistState,
		options: TodoistStateUpdateOptions,
	): Promise<void> {
		const previousTaskRef =
			this.options.sessionState.moduleState.todoist.taskRef;
		const taskIdentityChanged = previousTaskRef !== state.taskRef;
		const hasCurrentSession = this.currentSession !== null;
		const shouldIncrementRevision = taskIdentityChanged && hasCurrentSession;
		if (shouldIncrementRevision) {
			const currentSession = this.currentSession;
			if (currentSession !== null) currentSession.workRevision += 1;
		}
		return this.publishState.publish(state, options);
	}

	private updateTodoistState(
		state: TodoistState,
		options: TodoistStateUpdateOptions,
	): Promise<void> {
		return this.updateState(state, options);
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
			refreshFooterStatuses: () => undefined,
			updateTodoistState: this.updateTodoistState.bind(this),
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
