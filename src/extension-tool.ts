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
	refreshFooterStatuses,
	replaceSessionState,
} from "./extension-lifecycle.ts";
import { extensionResult } from "./extension-message.ts";
import type {
	ActiveSession,
	ExtensionRuntime,
	StateToolParams,
} from "./extension-types.ts";
import { githubPrUrl } from "./pr-detection.ts";
import { applyStatePatch } from "./session-state.ts";
import {
	clearAllAction,
	clearTaskAction,
	setTaskAction,
} from "./task-operations.ts";

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
	replaceSessionState(
		session,
		applyStatePatch(session.state, {
			prUrl: url,
			...(prChanged
				? {
						mergeCompletedAt: undefined,
						todoistCompletionAttemptedAt: undefined,
					}
				: {}),
		}),
	);
	session.allowPrDiscovery = false;
	appendState(runtime, session.state);
	refreshFooterStatuses(runtime, session);
	return extensionResult(`Pinned PR ${url}`);
}

function clearPrAction(
	runtime: ExtensionRuntime,
	session: ActiveSession,
): AgentToolResult<undefined> {
	replaceSessionState(
		session,
		applyStatePatch(session.state, {
			prUrl: undefined,
			mergeCompletedAt: undefined,
			todoistCompletionAttemptedAt: undefined,
		}),
	);
	session.allowPrDiscovery = false;
	appendState(runtime, session.state, true);
	refreshFooterStatuses(runtime, session);
	return extensionResult(C.message.prCleared);
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
	switch (params.action) {
		case C.action.status:
			return statusAction(session);
		case C.action.setPr:
			return setPrAction(runtime, session, params);
		case C.action.clearPr:
			return clearPrAction(runtime, session);
		case C.action.setTask:
			return setTaskAction(runtime, session, params, ctx);
		case C.action.clearTask:
			return clearTaskAction(runtime, session);
		default:
			return clearAllAction(runtime, session);
	}
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
