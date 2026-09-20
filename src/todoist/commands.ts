import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import {
	createModuleStatePublisher,
	type ModuleStatePublisher,
} from "../event-publishers.ts";
import { type Exec, spawnExec } from "../shared/command.ts";
import { EXTENSION_CONSTANTS as C } from "../shared/constants.ts";
import { type EventHandler, withLoading } from "../shared/events.ts";
import { inspectProject } from "../shared/project.ts";
import type { SessionState } from "../state.ts";
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
	TaskRefreshWorker,
	TaskRefreshWorkerInput,
	TaskRefreshWorkerResult,
	TodoistModuleState,
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

function getSelectedTaskContext(
	sessionState: SessionState,
): SelectedTaskContext | undefined {
	const sessionId = sessionState.session.activeSessionId;
	const taskRef = sessionState.moduleState.todoist.taskRef;
	const hasNoSession = sessionId === null;
	const hasNoTask = taskRef === undefined;
	const hasNoSelection = hasNoSession || hasNoTask;
	if (hasNoSelection) return undefined;
	return { sessionId, taskRef };
}

function clearSelectedTask(state: TodoistModuleState): TodoistModuleState {
	return {
		...state,
		taskRef: undefined,
		taskName: undefined,
		taskDescription: undefined,
		taskUrl: undefined,
	};
}

function refreshInput(
	sessionState: SessionState,
	ctx: ExtensionCommandContext,
	taskContext: SelectedTaskContext,
	worktree: Awaited<ReturnType<typeof inspectProject>>,
): TaskRefreshWorkerInput {
	const state = sessionState.moduleState.todoist;
	return {
		sessionId: taskContext.sessionId,
		cwd: ctx.cwd,
		taskRef: taskContext.taskRef,
		taskName: state.taskName ?? taskContext.taskRef,
		taskDescription: state.taskDescription ?? NO_TASK_DESCRIPTION,
		projectRef: state.todoistProjectRef ?? "",
		prRef: sessionState.moduleState.pr.prUrl ?? null,
		worktree,
	};
}

function applyRefreshResult(
	state: TodoistModuleState,
	result: TaskRefreshWorkerResult,
): TodoistModuleState {
	const nextState: TodoistModuleState = {
		...state,
		taskName: result.newTaskName ?? state.taskName,
		taskDescription: result.newTaskDescription ?? state.taskDescription,
	};
	const hasNotCompletedTask = !result.hasCompletedTask;
	if (hasNotCompletedTask) return nextState;
	return {
		...clearSelectedTask(nextState),
		todoistCompletionAttemptedAt: new Date().toISOString(),
	};
}

async function requestRefreshResult(
	sessionState: SessionState,
	ctx: ExtensionCommandContext,
	taskContext: SelectedTaskContext,
	taskRefreshWorker: TaskRefreshWorker | undefined,
	exec: Exec | undefined,
): Promise<TaskRefreshWorkerResult> {
	const run = exec ?? spawnExec;
	const worktree = await inspectProject(run, ctx.cwd);
	const worker = taskRefreshWorker ?? createTaskRefreshWorker(run);
	return worker(refreshInput(sessionState, ctx, taskContext, worktree));
}

async function refreshTaskNow(
	sessionState: SessionState,
	publisher: ModuleStatePublisher<"todoist">,
	ctx: ExtensionCommandContext,
	taskContext: SelectedTaskContext,
	taskRefreshWorker: TaskRefreshWorker | undefined,
	exec: Exec | undefined,
): Promise<void> {
	const result = await requestRefreshResult(
		sessionState,
		ctx,
		taskContext,
		taskRefreshWorker,
		exec,
	);
	await publisher.publish(
		applyRefreshResult(sessionState.moduleState.todoist, result),
		{ persist: true },
	);
	const taskCompleted = result.hasCompletedTask;
	const message = taskCompleted
		? TODOIST_TASK_COMPLETED
		: TODOIST_TASK_REFRESHED;
	notify(ctx, message, INFO);
}

async function runRefreshTask(
	sessionState: SessionState,
	eventHandler: EventHandler,
	publisher: ModuleStatePublisher<"todoist">,
	ctx: ExtensionCommandContext,
	taskRefreshWorker: TaskRefreshWorker | undefined,
	exec: Exec | undefined,
): Promise<void> {
	const selectedTask = getSelectedTaskContext(sessionState);
	const hasNoSelectedTask = selectedTask === undefined;
	if (hasNoSelectedTask) {
		notify(ctx, TODOIST_TASK_NOT_SELECTED, WARNING);
		return;
	}
	try {
		await withLoading(eventHandler, C.action.task, () =>
			refreshTaskNow(
				sessionState,
				publisher,
				ctx,
				selectedTask,
				taskRefreshWorker,
				exec,
			),
		);
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		notify(ctx, `${TODOIST_TASK_REFRESH_FAILED}: ${detail}`, WARNING);
	}
}

async function runDropTask(
	sessionState: SessionState,
	publisher: ModuleStatePublisher<"todoist">,
	ctx: ExtensionCommandContext,
): Promise<void> {
	const selectedTask = getSelectedTaskContext(sessionState);
	const hasNoSelectedTask = selectedTask === undefined;
	if (hasNoSelectedTask) {
		notify(ctx, TODOIST_TASK_NOT_SELECTED, WARNING);
		return;
	}
	await publisher.publish(clearSelectedTask(sessionState.moduleState.todoist), {
		persist: true,
	});
	notify(ctx, TODOIST_TASK_DROPPED, INFO);
}

export function register(
	pi: ExtensionAPI,
	sessionState: SessionState,
	eventHandler: EventHandler,
	taskRefreshWorker?: TaskRefreshWorker,
	exec?: Exec,
): void {
	if (typeof pi.registerCommand !== "function") return;
	const publisher = createModuleStatePublisher(eventHandler, "todoist");
	pi.registerCommand(REFRESH_TASK_COMMAND, {
		description: COMMAND_DESCRIPTION_REFRESH,
		handler: (_args, ctx) =>
			runRefreshTask(
				sessionState,
				eventHandler,
				publisher,
				ctx,
				taskRefreshWorker,
				exec,
			),
	});
	pi.registerCommand(DROP_TASK_COMMAND, {
		description: COMMAND_DESCRIPTION_DROP,
		handler: (_args, ctx) => runDropTask(sessionState, publisher, ctx),
	});
}
