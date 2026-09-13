import { spawnExec } from "../shared/command.ts";
import { inspectProject } from "../shared/project.ts";
import { applyStatePatch } from "../shared/session-state.ts";
import {
	CLAIM,
	COMPLETED,
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
	MergeRequest,
	TaskClaimWorkerResult,
	TodoistOperations,
	TodoistSession,
} from "./state.ts";
import { confirmTaskCompletion } from "./user-prompts.ts";

function isSessionRecord(
	operations: TodoistOperations,
	session: TodoistSession,
): boolean {
	return operations.getSession() === session;
}

function isCurrentMergeEvent(
	operations: TodoistOperations,
	session: TodoistSession,
	event: MergeRequest,
): boolean {
	const currentEpoch = operations.getLifecycleEpoch?.();
	const isCurrentSession = isSessionRecord(operations, session);
	const isSameSession = event.sessionId === session.sessionId;
	const isSameEpoch =
		currentEpoch === undefined || event.lifecycleEpoch === currentEpoch;
	const isCurrentSessionAndEvent = isCurrentSession && isSameSession;
	return isCurrentSessionAndEvent && isSameEpoch;
}

function mergeState(session: TodoistSession): {
	taskName: string;
	stateSnapshot: TodoistSession["state"];
	workRevision: number;
	operationGeneration: number;
} {
	const taskName = session.state.taskName ?? session.state.taskRef ?? "";
	return {
		taskName,
		stateSnapshot: structuredClone(session.state),
		workRevision: session.workRevision,
		operationGeneration: session.operationGeneration,
	};
}

function isCurrentEvent(
	operations: TodoistOperations,
	session: TodoistSession,
	event: TaskClaimResultEvent,
): boolean {
	const operation = operations.todoist.taskClaim;
	const isCurrentSession = isSessionRecord(operations, session);
	if (!isCurrentSession) return false;
	const isPending = operation.pending;
	if (!isPending) return false;
	const isExpectedWorker = operation.session === session;
	if (!isExpectedWorker) return false;
	return event.sessionId === session.sessionId;
}

function claimTaskData(
	result: TaskClaimWorkerResult,
): ClaimTaskData | undefined {
	const isClaimAction = result.action === CLAIM;
	if (!isClaimAction) return undefined;
	const hasNoError = result.error === null;
	if (!hasNoError) return undefined;
	const taskData = result.taskData;
	const hasTaskData = taskData !== null;
	if (!hasTaskData) return undefined;
	const id = taskData.id;
	if (id === null) return undefined;
	const claimId = id as string;
	return { ...taskData, id: claimId };
}

function persistClaim(
	operations: TodoistOperations,
	session: TodoistSession,
	taskData: ClaimTaskData,
): void {
	operations.replaceSessionState(
		session,
		applyStatePatch(session.state, {
			taskRef: taskData.id,
			taskName: taskData.title,
			taskUrl: `${TASK_URL}${taskData.id}`,
			mergeCompletedAt: undefined,
			todoistCompletionAttemptedAt: undefined,
		}),
	);
	operations.appendState(session.state, session.allowPrDiscovery === false);
	operations.refreshFooterStatuses(session);
	void operations.emitState(session);
	notifyTaskAssigned(session.context);
}

export function handleTaskClaimResult(
	operations: TodoistOperations,
	session: TodoistSession,
	event: TaskClaimResultEvent,
): void {
	const isStale = !isCurrentEvent(operations, session, event);
	if (isStale) return;
	operations.todoist.taskClaim.pending = false;
	operations.todoist.taskClaim.session = undefined;
	const taskData = claimTaskData(event.result);
	const hasClaim = taskData !== undefined;
	if (hasClaim) {
		operations.todoist.taskClaim.completed = true;
		const canPersist = session.state.taskRef === undefined;
		if (canPersist) persistClaim(operations, session, taskData);
		return;
	}
	operations.todoist.taskClaim.completed = false;
	const isCurrentSession = isSessionRecord(operations, session);
	if (!isCurrentSession) return;
	const error = event.result.error ?? INVALID_RESULT;
	notifyClaimFailure(session.context, error);
}

function errorResult(sessionId: string, error: string): TaskClaimWorkerResult {
	return { sessionId, action: ERROR, taskData: null, error };
}

export async function runTaskClaim(
	operations: TodoistOperations,
	session: TodoistSession,
	prompt: string,
): Promise<void> {
	try {
		const exec = operations.dependencies.exec ?? spawnExec;
		const worktree = await inspectProject(exec, session.context.cwd);
		const worker =
			operations.dependencies.taskClaimWorker ?? createTaskClaimWorker(exec);
		const result = await worker({
			sessionId: session.sessionId,
			prompt,
			cwd: session.context.cwd,
			projectRef: session.project.todoistProjectRef,
			prRef: session.state.prUrl ?? null,
			worktree,
		});
		handleTaskClaimResult(operations, session, {
			sessionId: result.sessionId,
			result,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		handleTaskClaimResult(operations, session, {
			sessionId: session.sessionId,
			result: errorResult(session.sessionId, message || UNKNOWN_ERROR),
		});
	}
}

export function maybeAnalyzeTaskClaim(
	operations: TodoistOperations,
	session: TodoistSession,
	prompt: string,
): void {
	const canStart =
		operations.getSession() === session && session.state.taskRef === undefined;
	const unavailableSession = !canStart;
	if (unavailableSession) return;
	const operation = operations.todoist.taskClaim;
	const isAlreadyHandled = operation.pending || operation.completed;
	if (isAlreadyHandled) return;
	operation.pending = true;
	operation.session = session;
	void runTaskClaim(operations, session, prompt);
}

async function consumeMergedEvent(
	operations: TodoistOperations,
	event: MergeRequest,
): Promise<void> {
	const alreadyCompleted = event.taskMarkedAsCompleted === true;
	if (alreadyCompleted) return;
	const session = operations.getSession();
	if (session === null) return;
	const isCurrentMerge = isCurrentMergeEvent(operations, session, event);
	if (!isCurrentMerge) return;
	const hasInteractiveUi = session.context.hasUI;
	if (!hasInteractiveUi) return;
	const taskRef = session.state.taskRef;
	if (taskRef === undefined) return;
	const { taskName, stateSnapshot, workRevision, operationGeneration } =
		mergeState(session);
	void operations.promptQueue
		.enqueue(async (isCurrent) => {
			const isCurrentBeforePrompt =
				isSessionRecord(operations, session) &&
				isCurrentMergeEvent(operations, session, event);
			const isPromptStale = !isCurrentBeforePrompt || !isCurrent();
			if (isPromptStale) return;
			const confirmed = await confirmTaskCompletion(
				session.context,
				taskName,
				taskRef,
			);
			const isConfirmed = confirmed === true;
			if (!isConfirmed) return;
			const isCurrentAfterPromptEpoch = isCurrent();
			if (!isCurrentAfterPromptEpoch) return;
			const isCurrentSessionAfterPrompt =
				isSessionRecord(operations, session) &&
				isCurrentMergeEvent(operations, session, event);
			if (!isCurrentSessionAfterPrompt) return;
			const completeMergedTask = operations.completeMergedTask;
			if (completeMergedTask === undefined) return;
			const result = await completeMergedTask(
				session,
				taskRef,
				stateSnapshot,
				workRevision,
				operationGeneration,
			);
			const completed = result === COMPLETED;
			if (completed) event.taskMarkedAsCompleted = true;
		})
		.catch(() => undefined);
}

export function registerTodoistMergeConsumer(
	operations: TodoistOperations,
): void {
	operations.eventHandler.prMergedEvent.subscribe(
		consumeMergedEvent.bind(null, operations),
	);
}
