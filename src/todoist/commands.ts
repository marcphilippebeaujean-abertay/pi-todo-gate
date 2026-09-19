import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { spawnExec } from "../shared/command.ts";
import { EXTENSION_CONSTANTS as C } from "../shared/constants.ts";
import { withLoading } from "../shared/events.ts";
import { inspectProject } from "../shared/project.ts";
import { enqueueSessionOperation } from "../shared/session-operations.ts";
import {
	COMMAND_DESCRIPTION_DROP,
	COMMAND_DESCRIPTION_REFRESH,
	DROP_TASK_COMMAND,
	INFO,
	NO_TASK_DESCRIPTION,
	REFRESH_TASK_COMMAND,
	TODOIST_TASK_COMPLETED,
	TODOIST_TASK_DROPPED,
	TODOIST_TASK_NOT_SELECTED,
	TODOIST_TASK_REFRESH_FAILED,
	TODOIST_TASK_REFRESHED,
	WARNING,
} from "./constants.ts";
import { createTaskRefreshWorker } from "./event-publishers.ts";
import type {
	SelectedTaskContext,
	TaskRefreshWorkerInput,
	TaskRefreshWorkerResult,
	TodoistOperations,
	TodoistState,
} from "./internal-state.ts";

function notify(
	ctx: ExtensionCommandContext,
	message: string,
	level: typeof INFO | typeof WARNING,
): void {
	const hasNoUI = !ctx.hasUI;
	if (hasNoUI) return;
	ctx.ui.notify(message, level);
}

function isCurrentTask(
	operations: TodoistOperations,
	taskContext: SelectedTaskContext,
): boolean {
	const { session, sessionId, taskRef, workRevision } = taskContext;
	const isCurrentSession = operations.getSession() === session;
	const isCurrentSessionId =
		operations.sessionState.session.activeSessionId === sessionId;
	const isCurrentTaskRef =
		operations.sessionState.moduleState.todoist.taskRef === taskRef;
	const isCurrentWorkRevision = session.workRevision === workRevision;
	return [
		isCurrentSession,
		isCurrentSessionId,
		isCurrentTaskRef,
		isCurrentWorkRevision,
	].every(Boolean);
}

function getSelectedTaskContext(
	operations: TodoistOperations,
): SelectedTaskContext | undefined {
	const session = operations.getSession();
	const sessionId = operations.sessionState.session.activeSessionId;
	const taskRef = operations.sessionState.moduleState.todoist.taskRef;
	const workRevision = session?.workRevision;
	const hasSession = session !== null;
	if (!hasSession) return undefined;
	const hasSessionId = sessionId !== null;
	if (!hasSessionId) return undefined;
	const hasTaskRef = taskRef !== undefined;
	if (!hasTaskRef) return undefined;
	const hasWorkRevision = workRevision !== undefined;
	if (!hasWorkRevision) return undefined;
	return { session, sessionId, taskRef, workRevision };
}

function clearSelectedTask(state: TodoistState): TodoistState {
	return {
		...state,
		taskRef: undefined,
		taskName: undefined,
		taskDescription: undefined,
		taskUrl: undefined,
	};
}

function currentProjectRef(operations: TodoistOperations): string {
	return operations.getProjectRef?.() ?? operations.projectRef;
}

function refreshInput(
	operations: TodoistOperations,
	taskContext: SelectedTaskContext,
	worktree: Awaited<ReturnType<typeof inspectProject>>,
): TaskRefreshWorkerInput {
	const { sessionId, session, taskRef } = taskContext;
	const state = operations.sessionState.moduleState.todoist;
	return {
		sessionId,
		cwd: session.context.cwd,
		taskRef,
		taskName: state.taskName ?? taskRef,
		taskDescription: state.taskDescription ?? NO_TASK_DESCRIPTION,
		projectRef: currentProjectRef(operations),
		prRef: operations.sessionState.moduleState.pr.prUrl ?? null,
		worktree,
	};
}

function applyRefreshResult(
	state: TodoistState,
	result: TaskRefreshWorkerResult,
): TodoistState {
	const nextState: TodoistState = {
		...state,
		taskName: result.newTaskName ?? state.taskName,
		taskDescription: result.newTaskDescription ?? state.taskDescription,
	};
	const hasCompletedTask = result.hasCompletedTask;
	if (!hasCompletedTask) return nextState;
	return {
		...clearSelectedTask(nextState),
		todoistCompletionAttemptedAt: new Date().toISOString(),
	};
}

async function requestRefreshResult(
	operations: TodoistOperations,
	ctx: ExtensionCommandContext,
	taskContext: SelectedTaskContext,
): Promise<TaskRefreshWorkerResult | undefined> {
	const exec = operations.exec ?? operations.dependencies?.exec ?? spawnExec;
	const worktree = await inspectProject(exec, ctx.cwd);
	const worker =
		operations.taskRefreshWorker ??
		operations.dependencies?.taskRefreshWorker ??
		createTaskRefreshWorker(exec);
	const result = await worker(refreshInput(operations, taskContext, worktree));
	const isCurrentAfterWorker = isCurrentTask(operations, taskContext);
	return isCurrentAfterWorker ? result : undefined;
}

async function refreshTaskNow(
	operations: TodoistOperations,
	ctx: ExtensionCommandContext,
	taskContext: SelectedTaskContext,
): Promise<void> {
	const result = await requestRefreshResult(operations, ctx, taskContext);
	const shouldIgnoreResult = result === undefined;
	if (shouldIgnoreResult) return;
	const isCurrentBeforePersist = isCurrentTask(operations, taskContext);
	if (!isCurrentBeforePersist) return;
	const nextState = applyRefreshResult(
		operations.sessionState.moduleState.todoist,
		result,
	);
	await operations.updateTodoistState(nextState, { persist: true });
	const hasCompletedTask = result.hasCompletedTask;
	const message = hasCompletedTask
		? TODOIST_TASK_COMPLETED
		: TODOIST_TASK_REFRESHED;
	notify(ctx, message, INFO);
}

async function runRefreshTask(
	operations: TodoistOperations,
	ctx: ExtensionCommandContext,
): Promise<void> {
	const selectedTask = getSelectedTaskContext(operations);
	const hasNoSelectedTask = selectedTask === undefined;
	if (hasNoSelectedTask) {
		notify(ctx, TODOIST_TASK_NOT_SELECTED, WARNING);
		return;
	}
	try {
		await withLoading(operations.eventHandler, C.action.task, () =>
			enqueueSessionOperation(
				selectedTask.session,
				refreshTaskNow.bind(null, operations, ctx, selectedTask),
			),
		);
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		notify(ctx, `${TODOIST_TASK_REFRESH_FAILED}: ${detail}`, WARNING);
	}
}

async function runDropTask(
	operations: TodoistOperations,
	ctx: ExtensionCommandContext,
): Promise<void> {
	const selectedTask = getSelectedTaskContext(operations);
	const hasNoSelectedTask = selectedTask === undefined;
	if (hasNoSelectedTask) {
		notify(ctx, TODOIST_TASK_NOT_SELECTED, WARNING);
		return;
	}
	await enqueueSessionOperation(selectedTask.session, async () => {
		const isCurrent = isCurrentTask(operations, selectedTask);
		const shouldSkip = !isCurrent;
		if (shouldSkip) return;
		await operations.updateTodoistState(
			clearSelectedTask(operations.sessionState.moduleState.todoist),
			{ persist: true },
		);
		notify(ctx, TODOIST_TASK_DROPPED, INFO);
	});
}

export function register(
	pi: ExtensionAPI,
	operations: TodoistOperations,
): void {
	if (typeof pi.registerCommand !== "function") return;
	pi.registerCommand(REFRESH_TASK_COMMAND, {
		description: COMMAND_DESCRIPTION_REFRESH,
		handler: (_args, ctx) => runRefreshTask(operations, ctx),
	});
	pi.registerCommand(DROP_TASK_COMMAND, {
		description: COMMAND_DESCRIPTION_DROP,
		handler: (_args, ctx) => runDropTask(operations, ctx),
	});
}
