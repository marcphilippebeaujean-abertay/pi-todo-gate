import { StringEnum } from "@earendil-works/pi-ai";
import type {
	AgentToolResult,
	AgentToolUpdateCallback,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { EXTENSION_CONSTANTS as C } from "../shared/constants.ts";
import { extensionResult } from "../shared/extension-message.ts";
import type { SessionContext, StateToolParams } from "../state.ts";
import { applyStatePatch, currentSessionContext } from "../state.ts";
import { githubPrUrl } from "./module.ts";
import type { StateToolRuntime } from "./state.ts";

export const stateParameters = Type.Object({
	action: StringEnum(["status", "set_pr", "clear_pr", "clear_all"] as const),
	url: Type.Optional(Type.String()),
});

function statusAction(session: SessionContext): AgentToolResult<undefined> {
	return extensionResult(
		JSON.stringify({
			...session.state,
			codingRoot: session.project.codingRoot,
		}),
	);
}

function setPrAction(
	runtime: StateToolRuntime,
	session: SessionContext,
	params: StateToolParams,
): AgentToolResult<undefined> {
	const url = githubPrUrl(params.url ?? "", session.state.remoteOrigin ?? null);
	if (url === null) throw new Error(C.message.invalidPr);
	const prChanged = session.state.prUrl !== url;
	runtime.replaceSessionState(
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
	runtime.appendState(session.state);
	runtime.refreshFooterStatuses(session);
	return extensionResult(`Pinned PR ${url}`);
}

function clearPrState(
	runtime: StateToolRuntime,
	session: SessionContext,
	message: string,
): AgentToolResult<undefined> {
	runtime.replaceSessionState(
		session,
		applyStatePatch(session.state, {
			prUrl: undefined,
			mergeCompletedAt: undefined,
			todoistCompletionAttemptedAt: undefined,
		}),
	);
	session.allowPrDiscovery = false;
	runtime.appendState(session.state, true);
	runtime.refreshFooterStatuses(session);
	return extensionResult(message);
}

export async function executeStateTool(
	runtime: StateToolRuntime,
	_toolCallId: string,
	params: StateToolParams,
	_signal: AbortSignal | undefined,
	_onUpdate: AgentToolUpdateCallback<undefined> | undefined,
	_ctx: ExtensionContext,
): Promise<AgentToolResult<undefined>> {
	const session = currentSessionContext(runtime.sessionState);
	const hasSession = session !== null;
	if (!hasSession) throw new Error(C.message.inactive);
	switch (params.action) {
		case C.action.status:
			return statusAction(session);
		case C.action.setPr:
			return setPrAction(runtime, session, params);
		case C.action.clearPr:
			return clearPrState(runtime, session, C.message.prCleared);
		default:
			return clearPrState(runtime, session, C.message.stateCleared);
	}
}

export function installStateTool(runtime: StateToolRuntime): void {
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
