import { StringEnum } from "@earendil-works/pi-ai";
import type {
	AgentToolResult,
	AgentToolUpdateCallback,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { EXTENSION_CONSTANTS as C } from "../shared/constants.ts";
import { extensionResult } from "../shared/extension-message.ts";
import { githubPrUrl } from "./module.ts";
import type {
	PrSession,
	PrWorkState,
	StateToolParams,
	StateToolRuntime,
} from "./state.ts";

export const stateParameters = Type.Object({
	action: StringEnum(["status", "set_pr", "clear_pr", "clear_all"] as const),
	url: Type.Optional(Type.String()),
});

function applyStatePatch(
	state: PrWorkState,
	patch: Partial<PrWorkState>,
): PrWorkState {
	const next = { ...state };
	for (const [key, value] of Object.entries(patch)) {
		if (value === undefined) delete next[key as keyof PrWorkState];
		else next[key as keyof PrWorkState] = value as never;
	}
	return next;
}

function statusAction(session: PrSession): AgentToolResult<undefined> {
	return extensionResult(
		JSON.stringify({
			...session.state,
			codingRoot: session.project.codingRoot,
		}),
	);
}

async function setPrAction(
	runtime: StateToolRuntime,
	session: PrSession,
	params: StateToolParams,
): Promise<AgentToolResult<undefined>> {
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
	await runtime.syncPrState?.(session);
	return extensionResult(`Pinned PR ${url}`);
}

async function clearPrState(
	runtime: StateToolRuntime,
	session: PrSession,
	message: string,
): Promise<AgentToolResult<undefined>> {
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
	await runtime.syncPrState?.(session);
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
	const session = runtime.getSession?.();
	const hasSession = session !== undefined && session !== null;
	if (!hasSession) throw new Error(C.message.inactive);
	switch (params.action) {
		case C.action.status:
			return statusAction(session);
		case C.action.setPr:
			return await setPrAction(runtime, session, params);
		case C.action.clearPr:
			return await clearPrState(runtime, session, C.message.prCleared);
		default:
			return await clearPrState(runtime, session, C.message.stateCleared);
	}
}

export function installStateTool(
	runtime: StateToolRuntime,
	getSession?: () => PrSession | null,
	syncPrState?: (session: PrSession) => Promise<void> | void,
): void {
	const hasSessionGetter = getSession !== undefined;
	const hasSync = syncPrState !== undefined;
	const hasOverrides = hasSessionGetter || hasSync;
	const effectiveRuntime = hasOverrides
		? {
				...runtime,
				...(hasSessionGetter ? { getSession } : {}),
				...(hasSync ? { syncPrState } : {}),
			}
		: runtime;
	const isRegistered = effectiveRuntime.registered;
	if (isRegistered) return;
	runtime.registered = true;
	effectiveRuntime.registered = true;
	effectiveRuntime.pi.registerTool<typeof stateParameters>({
		name: C.tool.state,
		label: C.tool.todoist,
		description: C.message.prDescription,
		promptSnippet: C.message.prPrompt,
		parameters: stateParameters,
		execute: executeStateTool.bind(null, effectiveRuntime),
	});
}
