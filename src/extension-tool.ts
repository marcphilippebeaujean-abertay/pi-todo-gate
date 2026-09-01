import { StringEnum } from "@earendil-works/pi-ai";
import type {
	AgentToolResult,
	AgentToolUpdateCallback,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { EXTENSION_CONSTANTS as C } from "./constants.ts";
import {
	appendState,
	cancelScheduledSync,
	createClient,
	refreshFooterStatuses,
	taskPath,
} from "./extension-lifecycle.ts";
import { extensionResult } from "./extension-message.ts";
import { clearLocalTasks } from "./extension-tasks.ts";
import type {
	ActiveSession,
	ExtensionRuntime,
	StateToolParams,
} from "./extension-types.ts";
import { syncTodoistToPiTasks } from "./pi-tasks-sync.ts";
import { githubPrUrl } from "./pr-detection.ts";
import { applyStatePatch } from "./session-state.ts";

export const stateParameters = Type.Object({
	action: StringEnum([
		"status",
		"set_pr",
		"clear_pr",
		"set_task",
		"clear_task",
		"clear_all",
	] as const),
	url: Type.Optional(Type.String()),
	task: Type.Optional(Type.String()),
});

function statusAction(session: ActiveSession): AgentToolResult<undefined> {
	return extensionResult(
		JSON.stringify({
			...session.state,
			codingRoot: session.project.codingRoot,
		}),
	);
}

function setPrAction(
	runtime: ExtensionRuntime,
	session: ActiveSession,
	params: StateToolParams,
): AgentToolResult<undefined> {
	const url = githubPrUrl(params.url ?? "");
	const hasInvalidUrl = url === null;
	if (hasInvalidUrl) throw new Error(C.message.invalidPr);
	const prChanged = session.state.prUrl !== url;
	session.state = applyStatePatch(session.state, {
		prUrl: url,
		...(prChanged
			? {
					mergeCompletedAt: undefined,
					todoistCompletionAttemptedAt: undefined,
				}
			: {}),
	});
	session.allowPrDiscovery = false;
	appendState(runtime, session.state);
	refreshFooterStatuses(session);
	return extensionResult(`Pinned PR ${url}`);
}

function clearPrAction(
	runtime: ExtensionRuntime,
	session: ActiveSession,
): AgentToolResult<undefined> {
	session.state = applyStatePatch(session.state, {
		prUrl: undefined,
		mergeCompletedAt: undefined,
		todoistCompletionAttemptedAt: undefined,
	});
	session.allowPrDiscovery = false;
	appendState(runtime, session.state, true);
	refreshFooterStatuses(session);
	return extensionResult(C.message.prCleared);
}

async function setTaskAction(
	runtime: ExtensionRuntime,
	session: ActiveSession,
	params: StateToolParams,
	ctx: ExtensionContext,
): Promise<AgentToolResult<undefined>> {
	const hasTask = params.task !== undefined;
	if (!hasTask) throw new Error(C.message.invalidTask);
	const task = params.task as string;
	cancelScheduledSync(session);
	const client = createClient(ctx, runtime.dependencies);
	const project = await client.resolveProject(
		session.project.todoistProjectRef,
	);
	const claimed = await client.claimTask(task, {
		id: project.id,
		currentTaskId: session.state.taskRef,
	});
	await syncTodoistToPiTasks(client, claimed.id, taskPath(session));
	session.syncAvailable = true;
	const taskChanged = session.state.taskRef !== claimed.id;
	session.state = applyStatePatch(session.state, {
		taskRef: claimed.id,
		taskName: claimed.content,
		taskUrl: claimed.webUrl ?? claimed.url,
		...(taskChanged
			? {
					mergeCompletedAt: undefined,
					todoistCompletionAttemptedAt: undefined,
				}
			: {}),
	});
	appendState(runtime, session.state, !session.allowPrDiscovery);
	refreshFooterStatuses(session);
	return extensionResult(
		`Claimed Todoist task ${claimed.webUrl ?? claimed.url ?? claimed.id}`,
	);
}

async function clearTaskAction(
	runtime: ExtensionRuntime,
	session: ActiveSession,
): Promise<AgentToolResult<undefined>> {
	cancelScheduledSync(session);
	await clearLocalTasks(session);
	session.state = applyStatePatch(session.state, {
		taskRef: undefined,
		taskName: undefined,
		taskUrl: undefined,
		mergeCompletedAt: undefined,
		todoistCompletionAttemptedAt: undefined,
	});
	appendState(runtime, session.state, !session.allowPrDiscovery);
	refreshFooterStatuses(session);
	return extensionResult(C.message.taskCleared);
}

async function clearAllAction(
	runtime: ExtensionRuntime,
	session: ActiveSession,
): Promise<AgentToolResult<undefined>> {
	cancelScheduledSync(session);
	await clearLocalTasks(session);
	session.state = {};
	session.allowPrDiscovery = false;
	appendState(runtime, session.state, true);
	refreshFooterStatuses(session);
	return extensionResult(C.message.stateCleared);
}

export async function executeStateTool(
	runtime: ExtensionRuntime,
	_toolCallId: string,
	params: StateToolParams,
	_signal: AbortSignal | undefined,
	_onUpdate: AgentToolUpdateCallback<undefined> | undefined,
	ctx: ExtensionContext,
): Promise<AgentToolResult<undefined>> {
	const session = runtime.active;
	const hasSession = session !== null;
	if (!hasSession) throw new Error(C.message.inactive);
	const isStatusAction = params.action === C.action.status;
	if (isStatusAction) return statusAction(session);
	const isSetPrAction = params.action === C.action.setPr;
	if (isSetPrAction) return setPrAction(runtime, session, params);
	const isClearPrAction = params.action === C.action.clearPr;
	if (isClearPrAction) return clearPrAction(runtime, session);
	const isSetTaskAction = params.action === C.action.setTask;
	if (isSetTaskAction) return setTaskAction(runtime, session, params, ctx);
	const isClearTaskAction = params.action === C.action.clearTask;
	if (isClearTaskAction) return clearTaskAction(runtime, session);
	return clearAllAction(runtime, session);
}

export function installStateTool(runtime: ExtensionRuntime): void {
	const isRegistered = runtime.registered;
	if (isRegistered) return;
	runtime.registered = true;
	runtime.pi.registerTool<typeof stateParameters>({
		name: C.tool.state,
		label: C.tool.todoist,
		description: C.message.prDescription,
		promptSnippet: C.message.prPrompt,
		parameters: stateParameters,
		execute: executeStateTool.bind(null, runtime),
	});
}
