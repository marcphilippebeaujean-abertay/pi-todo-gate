import { spawnExec } from "../shared/command.ts";
import { inspectProject } from "../shared/project.ts";
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
	TodoistCompletionSnapshot,
	TodoistOperations,
	TodoistSession,
	TodoistState,
} from "./internal-state.ts";
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
	const isSameSession =
		event.sessionId === operations.sessionState.session.activeSessionId;
	const isSameEpoch =
		currentEpoch === undefined || event.lifecycleEpoch === currentEpoch;
	const isCurrentSessionAndEvent = isCurrentSession && isSameSession;
	return isCurrentSessionAndEvent && isSameEpoch;
}

function mergeState(
	operations: TodoistOperations,
	session: TodoistSession,
): {
	taskName: string;
	stateSnapshot: TodoistCompletionSnapshot;
	workRevision: number;
	operationGeneration: number;
} {
	const todoistState = operations.sessionState.moduleState.todoist;
	const taskName = todoistState.taskName ?? todoistState.taskRef ?? "";
	return {
		taskName,
		stateSnapshot: {
			taskRef: todoistState.taskRef,
			prUrl: operations.sessionState.moduleState.pr.prUrl,
		},
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
	return event.sessionId === operations.sessionState.session.activeSessionId;
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

async function persistClaim(
	operations: TodoistOperations,
	session: TodoistSession,
	taskData: ClaimTaskData,
): Promise<void> {
	const current = operations.sessionState.moduleState.todoist;
	const nextState: TodoistState = {
		...current,
		taskRef: taskData.id,
		taskName: taskData.title,
		taskUrl: `${TASK_URL}${taskData.id}`,
		todoistCompletionAttemptedAt: undefined,
	};
	await operations.updateTodoistState(nextState, {
		persist: true,
		gitStatePatch: { mergeCompletedAt: undefined },
	});
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
		const canPersist =
			operations.sessionState.moduleState.todoist.taskRef === undefined;
		if (canPersist) void persistClaim(operations, session, taskData);
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
	lifecycleEpoch: number,
): Promise<void> {
	try {
		const exec = operations.exec ?? operations.dependencies?.exec ?? spawnExec;
		const worktree = await inspectProject(exec, session.context.cwd);
		const isCurrentSession = operations.getSession() === session;
		const isCurrentEpochAfterInspection =
			(operations.getLifecycleEpoch?.() ?? lifecycleEpoch) === lifecycleEpoch;
		if (!isCurrentSession) return;
		if (!isCurrentEpochAfterInspection) return;
		const worker =
			operations.taskClaimWorker ??
			operations.dependencies?.taskClaimWorker ??
			createTaskClaimWorker(exec);
		const result = await worker({
			sessionId: operations.sessionState.session.activeSessionId ?? "",
			prompt,
			cwd: session.context.cwd,
			projectRef: session.project.todoistProjectRef,
			prRef: operations.sessionState.moduleState.pr.prUrl ?? null,
			worktree,
		});
		const isCurrentEpoch =
			(operations.getLifecycleEpoch?.() ?? lifecycleEpoch) === lifecycleEpoch;
		if (!isCurrentEpoch) return;
		handleTaskClaimResult(operations, session, {
			sessionId: result.sessionId,
			result,
		});
	} catch (error) {
		const isCurrentEpoch =
			(operations.getLifecycleEpoch?.() ?? lifecycleEpoch) === lifecycleEpoch;
		if (!isCurrentEpoch) return;
		const message = error instanceof Error ? error.message : String(error);
		handleTaskClaimResult(operations, session, {
			sessionId: operations.sessionState.session.activeSessionId ?? "",
			result: errorResult(
				operations.sessionState.session.activeSessionId ?? "",
				message || UNKNOWN_ERROR,
			),
		});
	}
}

export function maybeAnalyzeTaskClaim(
	operations: TodoistOperations,
	session: TodoistSession,
	prompt: string,
	lifecycleEpoch?: number,
): void {
	const epoch = lifecycleEpoch ?? operations.getLifecycleEpoch?.() ?? 0;
	const isCurrentSession = operations.getSession() === session;
	const hasTaskRef =
		operations.sessionState.moduleState.todoist.taskRef !== undefined;
	const canStart = isCurrentSession && !hasTaskRef;
	const unavailableSession = !canStart;
	if (unavailableSession) return;
	const operation = operations.todoist.taskClaim;
	const isAlreadyHandled = operation.pending || operation.completed;
	if (isAlreadyHandled) return;
	operation.pending = true;
	operation.session = session;
	void runTaskClaim(operations, session, prompt, epoch);
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
	const taskRef = operations.sessionState.moduleState.todoist.taskRef;
	if (taskRef === undefined) return;
	const { taskName, stateSnapshot, workRevision, operationGeneration } =
		mergeState(operations, session);
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
