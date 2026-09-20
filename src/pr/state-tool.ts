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
import type {
	PrState,
	StateToolDependencies,
	StateToolParams,
} from "./internal-state.ts";
import { githubPrUrl } from "./parsing.ts";

export const stateParameters = Type.Object({
	action: StringEnum(["status", "set_pr", "clear_pr", "clear_all"] as const),
	url: Type.Optional(Type.String()),
});

function statusAction(
	state: PrState,
	ctx: ExtensionContext,
): AgentToolResult<undefined> {
	return extensionResult(
		JSON.stringify({
			...state,
			codingRoot: ctx.cwd,
		}),
	);
}

async function setPrAction(
	dependencies: StateToolDependencies,
	params: StateToolParams,
): Promise<AgentToolResult<undefined>> {
	const state = dependencies.sessionState;
	const current = state.moduleState.pr;
	const url = githubPrUrl(
		params.url ?? "",
		state.gitState.remoteOrigin ?? null,
	);
	if (url === null) throw new Error(C.message.invalidPr);
	const nextState: PrState = {
		...current,
		prUrl: url,
		discoveryDisabled: false,
	};
	await dependencies.publisher.publish(nextState, { persist: true });
	return extensionResult(`Pinned PR ${url}`);
}

async function clearPrState(
	dependencies: StateToolDependencies,
	message: string,
): Promise<AgentToolResult<undefined>> {
	const current = dependencies.sessionState.moduleState.pr;
	await dependencies.publisher.publish(
		{ ...current, prUrl: undefined, discoveryDisabled: true },
		{ persist: true },
	);
	return extensionResult(message);
}

export async function executeStateTool(
	dependencies: StateToolDependencies,
	_toolCallId: string,
	params: StateToolParams,
	_signal: AbortSignal | undefined,
	_onUpdate: AgentToolUpdateCallback<undefined> | undefined,
	ctx: ExtensionContext,
): Promise<AgentToolResult<undefined>> {
	if (dependencies.sessionState.session.activeSessionId === null)
		throw new Error(C.message.inactive);
	switch (params.action) {
		case C.action.status:
			return statusAction(dependencies.sessionState.moduleState.pr, ctx);
		case C.action.setPr:
			return await setPrAction(dependencies, params);
		case C.action.clearPr:
			return await clearPrState(dependencies, C.message.prCleared);
		default:
			return await clearPrState(dependencies, C.message.stateCleared);
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
