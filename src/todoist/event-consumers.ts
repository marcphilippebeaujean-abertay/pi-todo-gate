import { handleClaimError } from "../claim-error.ts";
import { EXTENSION_CONSTANTS as C } from "../constants.ts";
import {
	appendState,
	refreshFooterStatuses,
	replaceSessionState,
} from "../extension-lifecycle.ts";
import type { ActiveSession, ExtensionRuntime } from "../extension-types.ts";
import { applyStatePatch } from "../session-state.ts";
import { spawnExec } from "../shared/command.ts";
import type { EventRequest, SharedEventPayloads } from "../shared/events.ts";
import { inspectProject } from "../shared/project.ts";
import { completeMergedTask } from "../task-completion.ts";
import type { TaskClaimWorkerResult } from "./data.ts";
import { createTaskClaimWorker } from "./event-publishers.ts";

const TODOIST = "Todoist";
const CLAIM = "claim";
const ERROR = "error";
const INFO = "info";
const TASK_URL = "https://app.todoist.com/app/task/";
const INVALID_RESULT = "Invalid claim worker result.";
const UNKNOWN_ERROR = "Unknown claim error.";

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
	runtime: ExtensionRuntime,
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
	runtime: ExtensionRuntime,
	session: ActiveSession,
	taskData: ClaimTaskData,
): void {
	replaceSessionState(
		session,
		applyStatePatch(session.state, {
			taskRef: taskData.id,
			taskName: taskData.title,
			taskUrl: `${TASK_URL}${taskData.id}`,
			mergeCompletedAt: undefined,
			todoistCompletionAttemptedAt: undefined,
		}),
	);
	appendState(runtime, session.state, session.allowPrDiscovery === false);
	refreshFooterStatuses(runtime, session);
	session.context.ui.notify("Todoist task assigned", INFO);
}

export function handleTaskClaimResult(
	runtime: ExtensionRuntime,
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
	handleClaimError(session.context, { jobType: TODOIST, error });
}

function errorResult(sessionId: string, error: string): TaskClaimWorkerResult {
	return { sessionId, action: ERROR, taskData: null, error };
}

export async function runTaskClaim(
	runtime: ExtensionRuntime,
	session: ActiveSession,
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

const STARTED = true;

export function maybeAnalyzeTaskClaim(
	runtime: ExtensionRuntime,
	session: ActiveSession,
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

function taskPrompt(taskName: string): string {
	return `${C.todoist.completeLabelPrefix}${taskName}${C.todoist.completeLabelSuffix}?`;
}

type MergeRequest = EventRequest<SharedEventPayloads["prMerged"]>;

async function consumeMergedEvent(
	runtime: ExtensionRuntime,
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
	const confirmed = await session.context.ui.confirm(
		taskPrompt(taskName),
		`Todoist task ${taskRef}`,
	);
	if (!confirmed) return;
	const result = await completeMergedTask(
		runtime,
		session,
		session.context,
		taskRef,
		stateSnapshot,
		workRevision,
		operationGeneration,
	);
	const completed = result === C.exit.completed;
	if (!completed) return;
	request.payload.taskMarkedAsCompleted = true;
}

export function registerTodoistMergeConsumer(runtime: ExtensionRuntime): void {
	runtime.events.on(
		C.event.prMerged,
		consumeMergedEvent.bind(null, runtime),
		C.value.collect,
	);
}
