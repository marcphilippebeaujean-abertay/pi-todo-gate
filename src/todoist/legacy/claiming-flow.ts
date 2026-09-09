import { handleClaimError } from "../../claim-error.ts";
import {
	appendState,
	refreshFooterStatuses,
	replaceSessionState,
} from "../../extension-lifecycle.ts";
import type { ActiveSession, ExtensionRuntime } from "../../extension-types.ts";
import { applyStatePatch } from "../../session-state.ts";
import { spawnExec } from "../../shared/command.ts";
import { inspectProject } from "../../shared/project.ts";
import type { TaskClaimWorkerResult } from "./claim-worker.ts";
import { createTaskClaimWorker } from "./claim-worker.ts";

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
