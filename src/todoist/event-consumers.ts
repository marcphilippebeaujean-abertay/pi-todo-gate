import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createModuleStatePublisher } from "../event-publishers.ts";
import { type Exec, spawnExec } from "../shared/command.ts";
import { EXTENSION_CONSTANTS as C } from "../shared/constants.ts";
import { withLoading } from "../shared/events.ts";
import { modelReference } from "../shared/pi-worker.ts";
import { inspectProject } from "../shared/project.ts";
import type { SessionState } from "../state.ts";
import { register as registerTodoistCommands } from "./commands.ts";
import { completeMergedTask } from "./completion.ts";
import {
	CLAIM,
	ERROR,
	INVALID_RESULT,
	TASK_URL,
	UNKNOWN_ERROR,
} from "./constants.ts";
import {
	createTaskClaimWorker,
	notifyClaimFailure,
	notifyTaskAssigned,
} from "./event-publishers.ts";
import type { TaskClaimResultEvent } from "./events.ts";
import type {
	ClaimTaskData,
	TaskClaimWorker,
	TaskClaimWorkerResult,
	TodoistCompletionSnapshot,
	TodoistLifecycleConsumerOptions,
	TodoistModuleOptions,
	TodoistSession,
} from "./internal-state.ts";

export class TodoistConsumer {
	private readonly options: TodoistModuleOptions;
	private readonly publishState;

	constructor(options: TodoistModuleOptions) {
		this.options = options;
		this.publishState = createModuleStatePublisher(
			options.eventHandler,
			C.module.todoist,
		);
		registerTodoistLifecycleConsumers({
			eventHandler: options.eventHandler,
			sessionState: options.sessionState,
			taskClaimWorker: options.taskClaimWorker,
			exec: options.exec,
			activateSession: this.activateSession.bind(this),
			registerCommands: (pi) =>
				registerTodoistCommands(
					pi,
					options.sessionState,
					options.eventHandler,
					options.taskRefreshWorker,
					options.exec,
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

	completeMergedTask(
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

function registerTodoistSessionActivation(
	options: TodoistLifecycleConsumerOptions,
): void {
	options.eventHandler.sessionActivatedEvent.subscribe(({ session }) => {
		if (session === undefined) return;
		return options.activateSession(session);
	});
}

export function registerTodoistLifecycleConsumers(
	options: TodoistLifecycleConsumerOptions,
): void {
	let commandsRegistered = false;
	options.eventHandler.piToolRegistrationsBecameAvailableEvent.subscribe(
		({ pi }) => {
			if (commandsRegistered) return;
			commandsRegistered = true;
			options.registerCommands(pi);
		},
	);
	registerTodoistSessionActivation(options);
	options.eventHandler.beforeAgentStartEvent.subscribe(
		({ event, context, session }) => {
			if (options.sessionState.moduleState.todoist.taskRef !== undefined)
				return;
			maybeAnalyzeTaskClaim(
				options.sessionState,
				options.eventHandler,
				session,
				event.prompt,
				modelReference(context.model),
				options.taskClaimWorker,
				options.exec,
			);
		},
	);
}

function claimTaskData(
	result: TaskClaimWorkerResult,
): ClaimTaskData | undefined {
	const isClaim = result.action === CLAIM;
	const hasError = result.error !== null;
	const taskData = result.taskData;
	const hasTaskData = taskData !== null;
	const id = taskData?.id;
	const hasId = id !== null && id !== undefined;
	const isNotClaim = !isClaim;
	if (isNotClaim) return undefined;
	if (hasError) return undefined;
	if (!hasTaskData) return undefined;
	if (!hasId) return undefined;
	return { ...taskData, id: id as string };
}

export function handleTaskClaimResult(
	sessionState: SessionState,
	eventHandler: TodoistLifecycleConsumerOptions["eventHandler"],
	session: TodoistSession,
	event: TaskClaimResultEvent,
): void {
	const taskData = claimTaskData(event.result);
	const hasNoTaskData = taskData === undefined;
	if (hasNoTaskData) {
		notifyClaimFailure(session.context, event.result.error ?? INVALID_RESULT);
		return;
	}
	const current = sessionState.moduleState.todoist;
	const publisher = createModuleStatePublisher(eventHandler, C.module.todoist);
	void publisher.publish(
		{
			...current,
			taskRef: taskData.id,
			taskName: taskData.title,
			taskDescription: taskData.description,
			taskUrl: `${TASK_URL}${taskData.id}`,
			todoistCompletionAttemptedAt: undefined,
		},
		{ persist: true, gitStatePatch: { mergeCompletedAt: undefined } },
	);
	notifyTaskAssigned(session.context);
}

function errorResult(sessionId: string, error: string): TaskClaimWorkerResult {
	return { sessionId, action: ERROR, taskData: null, error };
}

export async function runTaskClaim(
	sessionState: SessionState,
	eventHandler: TodoistLifecycleConsumerOptions["eventHandler"],
	session: TodoistSession,
	prompt: string,
	model?: string,
	taskClaimWorker?: TaskClaimWorker,
	exec?: Exec,
): Promise<void> {
	try {
		const run = exec ?? spawnExec;
		const worktree = await inspectProject(run, session.context.cwd);
		const requiresWorktree = session.project.triggersOnlyOnWorktree === true;
		const shouldSkipOrdinaryCheckout = requiresWorktree && !worktree.isWorktree;
		if (shouldSkipOrdinaryCheckout) return;
		const worker = taskClaimWorker ?? createTaskClaimWorker(run);
		const result = await worker({
			sessionId: sessionState.session.activeSessionId ?? "",
			model,
			prompt,
			cwd: session.context.cwd,
			projectRef: sessionState.moduleState.todoist.todoistProjectRef ?? "",
			prRef: sessionState.moduleState.pr.prUrl ?? null,
			worktree,
		});
		handleTaskClaimResult(sessionState, eventHandler, session, {
			sessionId: result.sessionId,
			result,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		handleTaskClaimResult(sessionState, eventHandler, session, {
			sessionId: sessionState.session.activeSessionId ?? "",
			result: errorResult(
				sessionState.session.activeSessionId ?? "",
				message || UNKNOWN_ERROR,
			),
		});
	}
}

export function maybeAnalyzeTaskClaim(
	sessionState: SessionState,
	eventHandler: TodoistLifecycleConsumerOptions["eventHandler"],
	session: TodoistSession,
	prompt: string,
	model?: string,
	taskClaimWorker?: TaskClaimWorker,
	exec?: Exec,
): void {
	void withLoading(eventHandler, C.action.task, () =>
		runTaskClaim(
			sessionState,
			eventHandler,
			session,
			prompt,
			model,
			taskClaimWorker,
			exec,
		),
	);
}
