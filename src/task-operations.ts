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
import { enqueueSessionOperation } from "./session-operations.ts";
import { applyStatePatch } from "./session-state.ts";

async function setTaskActionNow(
	runtime: ExtensionRuntime,
	session: ActiveSession,
	params: StateToolParams,
	ctx: ExtensionContext,
): Promise<AgentToolResult<undefined>> {
	const hasTask = params.task !== undefined;
	if (!hasTask) throw new Error(C.message.invalidTask);
	const task = params.task as string;
	const client = createClient(ctx, runtime.dependencies);
	const project = await client.resolveProject(
		session.project.todoistProjectRef,
	);
	const claimed = await client.claimTask(task, {
		id: project.id,
		currentTaskId: session.state.taskRef,
	});
	const isCurrentSession = runtime.active === session;
	if (!isCurrentSession) return extensionResult(C.message.taskCleared);
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
	return enqueueSessionOperation(
		session,
		setTaskActionNow.bind(null, runtime, session, params, ctx),
	);
}

export function clearTaskAction(
	runtime: ExtensionRuntime,
	session: ActiveSession,
): Promise<AgentToolResult<undefined>> {
	return enqueueSessionOperation(
		session,
		clearTaskActionNow.bind(null, runtime, session),
	);
}

export function clearAllAction(
	runtime: ExtensionRuntime,
	session: ActiveSession,
): Promise<AgentToolResult<undefined>> {
	return enqueueSessionOperation(
		session,
		clearAllActionNow.bind(null, runtime, session),
	);
}
