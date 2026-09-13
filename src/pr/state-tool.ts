import { StringEnum } from "@earendil-works/pi-ai";
import type {
	AgentToolResult,
	AgentToolUpdateCallback,
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { EXTENSION_CONSTANTS as C } from "../shared/constants.ts";
import { extensionResult } from "../shared/extension-message.ts";
import { githubPrUrl } from "./parsing.ts";
import type {
	PrSession,
	PrWorkState,
	StateToolDependencies,
	StateToolParams,
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
	dependencies: StateToolDependencies,
	session: PrSession,
	params: StateToolParams,
): Promise<AgentToolResult<undefined>> {
	const url = githubPrUrl(params.url ?? "", session.state.remoteOrigin ?? null);
	if (url === null) throw new Error(C.message.invalidPr);
	const prChanged = session.state.prUrl !== url;
	dependencies.replaceSessionState(
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
	dependencies.appendState(session.state);
	dependencies.refreshFooterStatuses(session);
	await dependencies.syncPrState?.(session);
	return extensionResult(`Pinned PR ${url}`);
}

async function clearPrState(
	dependencies: StateToolDependencies,
	session: PrSession,
	message: string,
): Promise<AgentToolResult<undefined>> {
	dependencies.replaceSessionState(
		session,
		applyStatePatch(session.state, {
			prUrl: undefined,
			mergeCompletedAt: undefined,
			todoistCompletionAttemptedAt: undefined,
		}),
	);
	session.allowPrDiscovery = false;
	dependencies.appendState(session.state, true);
	dependencies.refreshFooterStatuses(session);
	await dependencies.syncPrState?.(session);
	return extensionResult(message);
}

export async function executeStateTool(
	dependencies: StateToolDependencies,
	_toolCallId: string,
	params: StateToolParams,
	_signal: AbortSignal | undefined,
	_onUpdate: AgentToolUpdateCallback<undefined> | undefined,
	_ctx: ExtensionContext,
): Promise<AgentToolResult<undefined>> {
	const session = dependencies.getSession?.();
	const hasSession = session !== undefined && session !== null;
	if (!hasSession) throw new Error(C.message.inactive);
	switch (params.action) {
		case C.action.status:
			return statusAction(session);
		case C.action.setPr:
			return await setPrAction(dependencies, session, params);
		case C.action.clearPr:
			return await clearPrState(dependencies, session, C.message.prCleared);
		default:
			return await clearPrState(dependencies, session, C.message.stateCleared);
	}
}

export function installStateTool(
	pi: ExtensionAPI,
	dependencies: StateToolDependencies,
): void {
	pi.registerTool<typeof stateParameters>({
		name: C.tool.state,
		label: C.tool.todoist,
		description: C.message.prDescription,
		promptSnippet: C.message.prPrompt,
		parameters: stateParameters,
		execute: executeStateTool.bind(null, dependencies),
	});
}
