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
	PrState,
	StateToolDependencies,
	StateToolParams,
} from "./state.ts";

export const stateParameters = Type.Object({
	action: StringEnum(["status", "set_pr", "clear_pr", "clear_all"] as const),
	url: Type.Optional(Type.String()),
});

function statusAction(
	session: PrSession,
	state: PrState,
): AgentToolResult<undefined> {
	return extensionResult(
		JSON.stringify({
			...state,
			codingRoot: session.project.codingRoot,
		}),
	);
}

async function setPrAction(
	dependencies: StateToolDependencies,
	session: PrSession,
	params: StateToolParams,
): Promise<AgentToolResult<undefined>> {
	const currentState = dependencies.getPrState();
	const url = githubPrUrl(
		params.url ?? "",
		dependencies.getRemoteOrigin() ?? null,
	);
	if (url === null) throw new Error(C.message.invalidPr);
	const prChanged = currentState.prUrl !== url;
	const nextState: PrState = {
		...currentState,
		prUrl: url,
		discoveryDisabled: true,
	};
	await dependencies.updatePrState(nextState, prChanged);
	await dependencies.syncPrState?.(session);
	return extensionResult(`Pinned PR ${url}`);
}

async function clearPrState(
	dependencies: StateToolDependencies,
	session: PrSession,
	message: string,
): Promise<AgentToolResult<undefined>> {
	const currentState = dependencies.getPrState();
	const nextState: PrState = {
		...currentState,
		prUrl: undefined,
		discoveryDisabled: true,
	};
	await dependencies.updatePrState(nextState, true);
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
			return statusAction(session, dependencies.getPrState());
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
