import { spawnExec } from "../shared/command.ts";
import { EXTENSION_CONSTANTS as C } from "../shared/constants.ts";
import { withLoading } from "../shared/events.ts";
import { modelReference } from "../shared/pi-worker.ts";
import { inspectProject } from "../shared/project.ts";
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
	TodoistOperations,
	TodoistSession,
	TodoistState,
} from "./internal-state.ts";

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
	options.eventHandler.sessionActivatedEvent.subscribe(
		({ context, session, sessionId }) => {
			const hasNoSession = session === undefined;
			if (hasNoSession) return;
			const isCurrentContext = session.context === context;
			if (!isCurrentContext) return;
			const isCurrentSession =
				options.sessionState.session.activeSessionId === sessionId;
			if (!isCurrentSession) return;
			return options.activateSession(session, sessionId);
		},
	);
	options.eventHandler.sessionResetEvent.subscribe(() =>
		options.resetSession(),
	);
	options.eventHandler.sessionDeactivatedEvent.subscribe(() =>
		options.resetSession(),
	);
	options.eventHandler.beforeAgentStartEvent.subscribe(
		({ event, context, session, sessionId }) => {
			const isCurrentContext =
				options.getSession()?.context === session.context;
			const isCurrentSessionId =
				options.sessionState.session.activeSessionId === sessionId;
			const hasTaskRef =
				options.sessionState.moduleState.todoist.taskRef !== undefined;
			const isCurrentSession = isCurrentContext && isCurrentSessionId;
			if (!isCurrentSession) return;
			if (hasTaskRef) return;
			options.maybeAnalyzeTaskClaim(
				event.prompt,
				modelReference(context.model),
			);
		},
	);
}

function isSessionRecord(
	operations: TodoistOperations,
	session: TodoistSession,
): boolean {
	return operations.getSession() === session;
}

function isCurrentEvent(
	operations: TodoistOperations,
	session: TodoistSession,
	event: TaskClaimResultEvent,
): boolean {
	const operation = operations.todoist.taskClaim;
	const isCurrentSession = isSessionRecord(operations, session);
	const isPending = operation.pending;
	const isExpectedSession = operation.session === session;
	const isExpectedEvent =
		event.sessionId === operations.sessionState.session.activeSessionId;
	const isExpectedResult = event.result.sessionId === event.sessionId;
	if (!isCurrentSession) return false;
	if (!isPending) return false;
	if (!isExpectedSession) return false;
	if (!isExpectedEvent) return false;
	return isExpectedResult;
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
	if (!isClaim) return undefined;
	if (hasError) return undefined;
	if (!hasTaskData) return undefined;
	if (!hasId) return undefined;
	return { ...taskData, id: id as string };
}

async function persistClaim(
	operations: TodoistOperations,
	session: TodoistSession,
	taskData: ClaimTaskData,
	sessionId: string,
): Promise<void> {
	const isCurrent = () =>
		operations.getSession() === session &&
		operations.sessionState.session.activeSessionId === sessionId;
	const isCurrentBeforePersist = isCurrent();
	if (!isCurrentBeforePersist) return;
	const current = operations.sessionState.moduleState.todoist;
	const nextState: TodoistState = {
		...current,
		taskRef: taskData.id,
		taskName: taskData.title,
		taskDescription: taskData.description,
		taskUrl: `${TASK_URL}${taskData.id}`,
		todoistCompletionAttemptedAt: undefined,
	};
	await operations.updateTodoistState(nextState, {
		persist: true,
		gitStatePatch: { mergeCompletedAt: undefined },
	});
	const isCurrentAfterPersist = isCurrent();
	if (!isCurrentAfterPersist) return;
	void operations.emitState(session);
	notifyTaskAssigned(session.context);
}

export function handleTaskClaimResult(
	operations: TodoistOperations,
	session: TodoistSession,
	event: TaskClaimResultEvent,
): void {
	const isCurrentClaimEvent = isCurrentEvent(operations, session, event);
	if (!isCurrentClaimEvent) return;
	operations.todoist.taskClaim.pending = false;
	operations.todoist.taskClaim.session = undefined;
	const taskData = claimTaskData(event.result);
	const hasTaskData = taskData !== undefined;
	if (hasTaskData) {
		operations.todoist.taskClaim.completed = true;
		const hasNoTaskRef =
			operations.sessionState.moduleState.todoist.taskRef === undefined;
		if (hasNoTaskRef)
			void persistClaim(operations, session, taskData, event.sessionId);
		return;
	}
	operations.todoist.taskClaim.completed = false;
	const isCurrentSession = isSessionRecord(operations, session);
	if (!isCurrentSession) return;
	notifyClaimFailure(session.context, event.result.error ?? INVALID_RESULT);
}

function errorResult(sessionId: string, error: string): TaskClaimWorkerResult {
	return { sessionId, action: ERROR, taskData: null, error };
}

function resolveTaskClaimWorker(
	operations: TodoistOperations,
	exec: import("../shared/command.ts").Exec,
): TaskClaimWorker {
	return (
		operations.taskClaimWorker ??
		operations.dependencies?.taskClaimWorker ??
		createTaskClaimWorker(exec)
	);
}

export async function runTaskClaim(
	operations: TodoistOperations,
	session: TodoistSession,
	prompt: string,
	sessionId: string,
	model?: string,
): Promise<void> {
	const isCurrentSessionId = () =>
		operations.sessionState.session.activeSessionId === sessionId;
	try {
		const exec = operations.exec ?? operations.dependencies?.exec ?? spawnExec;
		const worktree = await inspectProject(exec, session.context.cwd);
		const isCurrentSession = operations.getSession() === session;
		const isCurrentRootSessionId = isCurrentSessionId();
		if (!isCurrentSession) return;
		if (!isCurrentRootSessionId) return;
		const requiresWorktree = session.project.triggersOnlyOnWorktree === true;
		const shouldSkipOrdinaryCheckout = requiresWorktree && !worktree.isWorktree;
		if (shouldSkipOrdinaryCheckout) {
			operations.todoist.taskClaim.pending = false;
			operations.todoist.taskClaim.session = undefined;
			return;
		}
		const worker = resolveTaskClaimWorker(operations, exec);
		const result = await worker({
			sessionId,
			model,
			prompt,
			cwd: session.context.cwd,
			projectRef: operations.projectRef,
			prRef: operations.sessionState.moduleState.pr.prUrl ?? null,
			worktree,
		});
		const isCurrentResultSessionId = isCurrentSessionId();
		if (!isCurrentResultSessionId) return;
		handleTaskClaimResult(operations, session, {
			sessionId: result.sessionId,
			result,
		});
	} catch (error) {
		const isCurrentErrorSessionId = isCurrentSessionId();
		if (!isCurrentErrorSessionId) return;
		const message = error instanceof Error ? error.message : String(error);
		handleTaskClaimResult(operations, session, {
			sessionId,
			result: errorResult(sessionId, message || UNKNOWN_ERROR),
		});
	}
}

export function maybeAnalyzeTaskClaim(
	operations: TodoistOperations,
	session: TodoistSession,
	prompt: string,
	model?: string,
): void {
	const expectedSessionId = operations.sessionState.session.activeSessionId;
	if (expectedSessionId === null) return;
	const isCurrentSession = operations.getSession() === session;
	const isCurrentRootSession =
		operations.sessionState.session.activeSessionId === expectedSessionId;
	const hasTaskRef =
		operations.sessionState.moduleState.todoist.taskRef !== undefined;
	if (!isCurrentSession) return;
	if (!isCurrentRootSession) return;
	if (hasTaskRef) return;
	const operation = operations.todoist.taskClaim;
	const claimAlreadyHandled = operation.pending || operation.completed;
	if (claimAlreadyHandled) return;
	operation.pending = true;
	operation.session = session;
	void withLoading(operations.eventHandler, C.status.task, () =>
		runTaskClaim(operations, session, prompt, expectedSessionId, model),
	);
}
