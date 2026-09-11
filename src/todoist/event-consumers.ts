import { EXTENSION_CONSTANTS as C } from "../constants.ts";
import { applyStatePatch } from "../session-state.ts";
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
import type {
	ClaimTaskData,
	MergeRequest,
	TaskClaimResultEvent,
	TaskClaimWorkerResult,
	TodoistRuntime,
	TodoistSession,
} from "./state.ts";
import { confirmTaskCompletion } from "./user-prompts.ts";

function isActiveSession(
	runtime: TodoistRuntime,
	session: TodoistSession,
): boolean {
	return runtime.active === session;
}

function isCurrentEvent(
	runtime: TodoistRuntime,
	session: TodoistSession,
	event: TaskClaimResultEvent,
): boolean {
	const operation = runtime.taskClaim;
	const isCurrentSession = isActiveSession(runtime, session);
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
	runtime: TodoistRuntime,
	session: TodoistSession,
	taskData: ClaimTaskData,
): void {
	runtime.replaceSessionState(
		session,
		applyStatePatch(session.state, {
			taskRef: taskData.id,
			taskName: taskData.title,
			taskUrl: `${TASK_URL}${taskData.id}`,
			mergeCompletedAt: undefined,
			todoistCompletionAttemptedAt: undefined,
		}),
	);
	runtime.appendState(session.state, session.allowPrDiscovery === false);
	runtime.refreshFooterStatuses(session);
	notifyTaskAssigned(session.context);
}

export function handleTaskClaimResult(
	runtime: TodoistRuntime,
	session: TodoistSession,
	event: TaskClaimResultEvent,
): void {
	const isStale = !isCurrentEvent(runtime, session, event);
	if (isStale) return;
	runtime.taskClaim.pending = false;
	runtime.taskClaim.session = undefined;
	const taskData = claimTaskData(event.result);
	const hasClaim = taskData !== undefined;
	if (hasClaim) {
		runtime.taskClaim.completed = true;
		const canPersist = session.state.taskRef === undefined;
		if (canPersist) persistClaim(runtime, session, taskData);
		return;
	}
	runtime.taskClaim.completed = false;
	const isCurrentSession = isActiveSession(runtime, session);
	if (!isCurrentSession) return;
	const error = event.result.error ?? INVALID_RESULT;
	notifyClaimFailure(session.context, error);
}

function errorResult(sessionId: string, error: string): TaskClaimWorkerResult {
	return { sessionId, action: ERROR, taskData: null, error };
}

export async function runTaskClaim(
	runtime: TodoistRuntime,
	session: TodoistSession,
	prompt: string,
): Promise<void> {
	try {
		const exec = runtime.dependencies.exec ?? spawnExec;
		const worktree = await inspectProject(exec, session.context.cwd);
		const worker =
			runtime.dependencies.taskClaimWorker ?? createTaskClaimWorker(exec);
		const result = await worker({
			sessionId: session.sessionId,
			prompt,
			cwd: session.context.cwd,
			projectRef: session.project.todoistProjectRef,
			prRef: session.state.prUrl ?? null,
			worktree,
		});
		handleTaskClaimResult(runtime, session, {
			sessionId: result.sessionId,
			result,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		handleTaskClaimResult(runtime, session, {
			sessionId: session.sessionId,
			result: errorResult(session.sessionId, message || UNKNOWN_ERROR),
		});
	}
}

export function maybeAnalyzeTaskClaim(
	runtime: TodoistRuntime,
	session: TodoistSession,
	prompt: string,
): void {
	const canStart =
		runtime.active === session && session.state.taskRef === undefined;
	const unavailableSession = !canStart;
	if (unavailableSession) return;
	const operation = runtime.taskClaim;
	const isAlreadyHandled = operation.pending || operation.completed;
	if (isAlreadyHandled) return;
	operation.pending = true;
	operation.session = session;
	void runTaskClaim(runtime, session, prompt);
}

async function consumeMergedEvent(
	runtime: TodoistRuntime,
	request: MergeRequest,
): Promise<void> {
	const alreadyCompleted = request.payload.taskMarkedAsCompleted === true;
	if (alreadyCompleted) return;
	const session = runtime.active;
	if (session === null) return;
	const hasInteractiveUi = session.context.hasUI;
	if (!hasInteractiveUi) return;
	const taskRef = session.state.taskRef;
	if (taskRef === undefined) return;
	const taskName = session.state.taskName ?? taskRef;
	const stateSnapshot = structuredClone(session.state);
	const workRevision = session.workRevision;
	const operationGeneration = session.operationGeneration;
	void runtime.promptQueue.enqueue(async (isCurrent) => {
		const isCurrentBeforePrompt = isActiveSession(runtime, session);
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
		const isCurrentSessionAfterPrompt = isActiveSession(runtime, session);
		if (!isCurrentSessionAfterPrompt) return;
		const result = await runtime.completeMergedTask(
			session,
			taskRef,
			stateSnapshot,
			workRevision,
			operationGeneration,
		);
		const completed = result === COMPLETED;
		if (completed) request.payload.taskMarkedAsCompleted = true;
	});
}

export function registerTodoistMergeConsumer(runtime: TodoistRuntime): void {
	runtime.events.on(
		C.event.prMerged,
		consumeMergedEvent.bind(null, runtime),
		C.value.collect,
	);
}
