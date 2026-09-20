import { createModuleStatePublisher } from "../event-publishers.ts";
import { type Exec, spawnExec } from "../shared/command.ts";
import { EXTENSION_CONSTANTS as C } from "../shared/constants.ts";
import { withLoading } from "../shared/events.ts";
import { modelReference } from "../shared/pi-worker.ts";
import { inspectProject } from "../shared/project.ts";
import type { SessionState } from "../state.ts";
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
	TodoistLifecycleConsumerOptions,
	TodoistSession,
} from "./internal-state.ts";

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
	const publisher = createModuleStatePublisher(eventHandler, "todoist");
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
