import type {
	AgentToolResult,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { EXTENSION_CONSTANTS as C } from "./constants.ts";
import {
	appendState,
	createClient,
	refreshFooterStatuses,
	replaceSessionState,
} from "./extension-lifecycle.ts";
import { extensionResult } from "./extension-message.ts";
import type {
	ActiveSession,
	ExtensionRuntime,
	StateToolParams,
} from "./extension-types.ts";
import {
	enqueueSessionOperation,
	getOperationGeneration,
	invalidateOperations,
	isCurrentOperation,
} from "./session-operations.ts";
import { applyStatePatch } from "./session-state.ts";
import {
	type IsCurrentOperation,
	TodoistOperationCancelled,
	type TodoistTask,
} from "./todoist.ts";

function currentTaskOperation(
	runtime: ExtensionRuntime,
	session: ActiveSession,
	generation: number,
): IsCurrentOperation {
	return () =>
		runtime.active === session && isCurrentOperation(session, generation);
}

function persistClaimedTask(
	runtime: ExtensionRuntime,
	session: ActiveSession,
	claimed: TodoistTask,
): AgentToolResult<undefined> {
	const taskChanged = session.state.taskRef !== claimed.id;
	replaceSessionState(
		session,
		applyStatePatch(session.state, {
			taskRef: claimed.id,
			taskName: claimed.content,
			taskUrl: claimed.webUrl ?? claimed.url,
			...(taskChanged
				? {
						mergeCompletedAt: undefined,
						todoistCompletionAttemptedAt: undefined,
					}
				: {}),
		}),
	);
	appendState(runtime, session.state, !session.allowPrDiscovery);
	refreshFooterStatuses(session);
	return extensionResult(
		`Claimed Todoist task ${claimed.webUrl ?? claimed.url ?? claimed.id}`,
	);
}

async function setTaskActionNow(
	runtime: ExtensionRuntime,
	session: ActiveSession,
	params: StateToolParams,
	ctx: ExtensionContext,
	generation: number,
): Promise<AgentToolResult<undefined>> {
	const hasTask = params.task !== undefined;
	if (!hasTask) throw new Error(C.message.invalidTask);
	const task = params.task as string;
	const isCurrent = currentTaskOperation(runtime, session, generation);
	const isCurrentBeforeClaim = isCurrent();
	if (!isCurrentBeforeClaim) return extensionResult(C.message.taskCleared);
	try {
		const client = createClient(ctx, runtime.dependencies);
		const project = await client.resolveProject(
			session.project.todoistProjectRef,
			isCurrent,
		);
		const claimed = await client.claimTask(
			task,
			{
				id: project.id,
				currentTaskId: session.state.taskRef,
			},
			isCurrent,
		);
		const isCurrentSession = isCurrent();
		if (!isCurrentSession) return extensionResult(C.message.taskCleared);
		return persistClaimedTask(runtime, session, claimed);
	} catch (error) {
		const isStale = !isCurrent();
		const isCancellation = error instanceof TodoistOperationCancelled;
		const shouldIgnoreError = isStale || isCancellation;
		if (shouldIgnoreError) return extensionResult(C.message.taskCleared);
		throw error;
	}
}

async function clearTaskActionNow(
	runtime: ExtensionRuntime,
	session: ActiveSession,
): Promise<AgentToolResult<undefined>> {
	const isCurrentSession = runtime.active === session;
	if (!isCurrentSession) return extensionResult(C.message.taskCleared);
	replaceSessionState(
		session,
		applyStatePatch(session.state, {
			taskRef: undefined,
			taskName: undefined,
			taskUrl: undefined,
			mergeCompletedAt: undefined,
			todoistCompletionAttemptedAt: undefined,
		}),
	);
	appendState(runtime, session.state, !session.allowPrDiscovery);
	refreshFooterStatuses(session);
	return extensionResult(C.message.taskCleared);
}

async function clearAllActionNow(
	runtime: ExtensionRuntime,
	session: ActiveSession,
): Promise<AgentToolResult<undefined>> {
	const isCurrentSession = runtime.active === session;
	if (!isCurrentSession) return extensionResult(C.message.stateCleared);
	replaceSessionState(session, {});
	session.allowPrDiscovery = false;
	appendState(runtime, session.state, true);
	refreshFooterStatuses(session);
	return extensionResult(C.message.stateCleared);
}

export function setTaskAction(
	runtime: ExtensionRuntime,
	session: ActiveSession,
	params: StateToolParams,
	ctx: ExtensionContext,
): Promise<AgentToolResult<undefined>> {
	const generation = getOperationGeneration(session);
	return enqueueSessionOperation(
		session,
		setTaskActionNow.bind(null, runtime, session, params, ctx, generation),
	);
}

export function clearTaskAction(
	runtime: ExtensionRuntime,
	session: ActiveSession,
): Promise<AgentToolResult<undefined>> {
	invalidateOperations(session);
	return clearTaskActionNow(runtime, session);
}

export function clearAllAction(
	runtime: ExtensionRuntime,
	session: ActiveSession,
): Promise<AgentToolResult<undefined>> {
	invalidateOperations(session);
	return clearAllActionNow(runtime, session);
}
