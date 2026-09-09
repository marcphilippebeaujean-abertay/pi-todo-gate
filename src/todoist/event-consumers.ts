import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { EXTENSION_CONSTANTS as C } from "../constants.ts";
import { applyStatePatch } from "../session-state.ts";
import type { Exec } from "../shared/command.ts";
import { spawnExec } from "../shared/command.ts";
import type {
	EventRequest,
	SharedEventPayloads,
	SharedEvents,
} from "../shared/events.ts";
import type { ExitActionResult } from "../shared/exit-actions.ts";
import { inspectProject } from "../shared/project.ts";
import type { WorkState } from "../types.ts";
import {
	CLAIM,
	COMPLETED,
	ERROR,
	INVALID_RESULT,
	STARTED,
	TASK_URL,
	UNKNOWN_ERROR,
} from "./constants.ts";
import type { TaskClaimWorker, TaskClaimWorkerResult } from "./data.ts";
import { createTaskClaimWorker } from "./event-publishers.ts";
import { notifyClaimFailure, notifyTaskAssigned } from "./notifications.ts";
import { confirmTaskCompletion } from "./user-prompts.ts";

type TodoistSession = {
	sessionId: string;
	context: ExtensionContext;
	project: { todoistProjectRef: string };
	state: WorkState;
	allowPrDiscovery: boolean;
	taskClaimAnalysisStarted: boolean;
	taskClaimGeneration: number;
	workRevision: number;
	operationGeneration: number;
};

type TodoistRuntime = {
	active: TodoistSession | null;
	dependencies: { exec?: Exec; taskClaimWorker?: TaskClaimWorker };
	events: SharedEvents;
	appendState(state: WorkState, prDiscoveryDisabled?: boolean): void;
	refreshFooterStatuses(session: TodoistSession): void;
	replaceSessionState(session: TodoistSession, nextState: WorkState): void;
	completeMergedTask(
		session: TodoistSession,
		taskRef: string,
		stateSnapshot: WorkState,
		workRevision: number,
		operationGeneration: number,
	): Promise<ExitActionResult>;
};

type ClaimTaskData = {
	title: string;
	description: string;
	id: string;
};

export interface TaskClaimResultEvent {
	sessionId: string;
	generation: number;
	result: TaskClaimWorkerResult;
}

function isCurrentEvent(
	runtime: TodoistRuntime,
	event: TaskClaimResultEvent,
): boolean {
	const session = runtime.active;
	const hasSession = session !== null;
	if (!hasSession) return false;
	const isCurrentSession = session.sessionId === event.sessionId;
	const isCurrentGeneration = session.taskClaimGeneration === event.generation;
	return isCurrentSession && isCurrentGeneration;
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
	event: TaskClaimResultEvent,
): void {
	const isStale = !isCurrentEvent(runtime, event);
	if (isStale) return;
	const session = runtime.active;
	if (session === null) return;
	const taskData = claimTaskData(event.result);
	const hasClaim = taskData !== undefined;
	if (hasClaim) {
		persistClaim(runtime, session, taskData);
		return;
	}
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
	generation: number,
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
		handleTaskClaimResult(runtime, {
			sessionId: result.sessionId,
			generation,
			result,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		handleTaskClaimResult(runtime, {
			sessionId: session.sessionId,
			generation,
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
	const alreadyStarted = session.taskClaimAnalysisStarted;
	const unavailableSession = !canStart;
	if (unavailableSession) return;
	if (alreadyStarted) return;
	session.taskClaimAnalysisStarted = STARTED;
	const generation = ++session.taskClaimGeneration;
	void runTaskClaim(runtime, session, prompt, generation);
}

type MergeRequest = EventRequest<SharedEventPayloads["prMerged"]>;

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
	const confirmed = await confirmTaskCompletion(
		session.context,
		taskName,
		taskRef,
	);
	if (!confirmed) return;
	const result = await runtime.completeMergedTask(
		session,
		taskRef,
		stateSnapshot,
		workRevision,
		operationGeneration,
	);
	const completed = result === COMPLETED;
	if (!completed) return;
	request.payload.taskMarkedAsCompleted = true;
}

export function registerTodoistMergeConsumer(runtime: TodoistRuntime): void {
	runtime.events.on(
		C.event.prMerged,
		consumeMergedEvent.bind(null, runtime),
		C.value.collect,
	);
}
