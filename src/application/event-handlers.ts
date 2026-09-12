import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { updateWorkingTreeStatus } from "../footer/module.ts";

import { spawnExec } from "../shared/command.ts";
import { EXTENSION_CONSTANTS as C } from "../shared/constants.ts";
import type {
	BeforeAgentStartEvent,
	BeforeAgentStartResultEvent,
	MessageEndEvent,
	ToolResultEvent,
} from "../shared/events.ts";
import { textOf } from "../shared/extension-message.ts";
import { hasUncommittedChanges } from "../shared/project.ts";
import type { ExtensionState, SessionContext } from "../state.ts";
import { currentSessionContext } from "../state.ts";
import { maybeAnalyzeTaskClaim } from "../todoist/module.ts";

export async function handleMessageEnd(
	runtime: ExtensionState,
	event: MessageEndEvent,
): Promise<void> {
	await runtime.pr.persistPrIfAvailable(textOf(event.message));
}

async function buildBeforeAgentMessages(
	runtime: ExtensionState,
	session: SessionContext,
	event: BeforeAgentStartEvent,
	ctx: ExtensionContext,
): Promise<string[]> {
	const messages: string[] = [];
	const hasHandoffContext = session.handoffContext;
	if (hasHandoffContext) {
		messages.push(
			`This is the task and PR that we were working on.\nTask: ${session.state.taskUrl ?? C.value.none}\nPR: ${session.state.prUrl ?? C.value.none}`,
		);
		session.handoffContext = false;
	}
	if (session.state.taskRef === undefined)
		maybeAnalyzeTaskClaim(runtime, session, event.prompt);
	const hasWorkChanged = session.workChanged;
	if (hasWorkChanged) await runtime.pr.appendBeforeAgentPrompt(ctx, messages);
	return messages;
}

export async function handleBeforeAgentStart(
	runtime: ExtensionState,
	event: BeforeAgentStartEvent,
	ctx: ExtensionContext,
): Promise<BeforeAgentStartResultEvent | undefined> {
	const session = currentSessionContext(runtime.sessionState);
	const hasSession = session !== null;
	if (!hasSession) return undefined;
	const messages = await buildBeforeAgentMessages(runtime, session, event, ctx);
	const hasMessages = messages.length > 0;
	if (!hasMessages) return undefined;
	return {
		message: {
			customType: C.message.context,
			content: messages.join("\n"),
			display: false,
		},
	};
}

export async function handleToolResult(
	runtime: ExtensionState,
	event: ToolResultEvent,
	ctx: ExtensionContext,
): Promise<void> {
	const session = currentSessionContext(runtime.sessionState);
	const shouldIgnoreToolResult = session === null || event.isError;
	if (shouldIgnoreToolResult) return;
	if (session === null) return;
	const toolName = event.toolName;
	const isEditTool = toolName === C.tool.edit;
	const isWriteTool = toolName === C.tool.write;
	const isFileMutation = isEditTool || isWriteTool;
	if (isFileMutation) session.workChanged = true;
	const isBashTool = toolName === C.tool.bash;
	const shouldRefreshWorkingTreeStatus = isFileMutation || isBashTool;
	if (!shouldRefreshWorkingTreeStatus) return;
	const workingTreeStatus = await hasUncommittedChanges(
		runtime.dependencies.exec ?? spawnExec,
		ctx.cwd,
	);
	if (workingTreeStatus === null) return;
	updateWorkingTreeStatus(runtime.footer, session, workingTreeStatus);
}
