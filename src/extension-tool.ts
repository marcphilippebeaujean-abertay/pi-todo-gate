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

export const stateParameters = Type.Object({
	action: StringEnum(["status", "set_pr", "clear_pr", "clear_all"] as const),
	url: Type.Optional(Type.String()),
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
	if (url === null) throw new Error(C.message.invalidPr);
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
	refreshFooterStatuses(session);
	return extensionResult(`Pinned PR ${url}`);
}

function clearPrState(
	runtime: ExtensionRuntime,
	session: ActiveSession,
	message: string,
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
	refreshFooterStatuses(session);
	return extensionResult(message);
}

export async function executeStateTool(
	runtime: ExtensionRuntime,
	_toolCallId: string,
	params: StateToolParams,
	_signal: AbortSignal | undefined,
	_onUpdate: AgentToolUpdateCallback<undefined> | undefined,
	_ctx: ExtensionContext,
): Promise<AgentToolResult<undefined>> {
	const session = runtime.active;
	const hasSession = session !== null;
	if (!hasSession) throw new Error(C.message.inactive);
	const action = params.action;
	const isStatusAction = action === C.action.status;
	if (isStatusAction) return statusAction(session);
	const isSetPrAction = action === C.action.setPr;
	if (isSetPrAction) return setPrAction(runtime, session, params);
	const isClearPrAction = action === C.action.clearPr;
	if (isClearPrAction)
		return clearPrState(runtime, session, C.message.prCleared);
	return clearPrState(runtime, session, C.message.stateCleared);
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
