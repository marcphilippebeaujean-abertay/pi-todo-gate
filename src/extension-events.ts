import type {
	BeforeAgentStartEvent,
	BeforeAgentStartEventResult,
	ExtensionContext,
	MessageEndEvent,
	ToolResultEvent,
} from "@earendil-works/pi-coding-agent";
import { EXTENSION_CONSTANTS as C } from "./constants.ts";
import {
	appendState,
	refreshFooterStatuses,
	replaceSessionState,
} from "./extension-lifecycle.ts";
import { textOf } from "./extension-message.ts";
import { linkInferredTask, scheduleSync } from "./extension-tasks.ts";
import type { ActiveSession, ExtensionRuntime } from "./extension-types.ts";
import {
	type Exec,
	findOpenPr,
	inspectWorktree,
	matchesPinnedPr,
	spawnExec,
} from "./git.ts";
import { githubPrUrl } from "./pr-detection.ts";
import { applyStatePatch } from "./session-state.ts";
import { matchesWorkState } from "./shared/work-state.ts";
import { completeMergedTask } from "./task-completion.ts";

const STRING_TYPE = "string";
const GIT_MUTATION_RE =
	/\bgit\s+(add|commit|merge|rebase|checkout|switch|cherry-pick)\b/;
const BASH_COMMAND = "command";
const MISSING_TASK_WARNING = "you have no claimed a todoist task yet!";
const TASK_TOOL_NAMES = new Set([
	"TaskCreate",
	"TaskUpdate",
	"TaskStop",
	"TaskExecute",
]);

export function persistPrIfAvailable(
	runtime: ExtensionRuntime,
	text: string,
): void {
	const session = runtime.active;
	const hasSession = session !== null;
	if (!hasSession) return;
	const hasPrUrl = Boolean(session.state.prUrl);
	const shouldSkipPrPersistence = !session.allowPrDiscovery || hasPrUrl;
	if (shouldSkipPrPersistence) return;
	const url = githubPrUrl(text);
	const hasUrl = url !== null;
	if (!hasUrl) return;
	replaceSessionState(session, applyStatePatch(session.state, { prUrl: url }));
	session.allowPrDiscovery = false;
	appendState(runtime, session.state);
	refreshFooterStatuses(session);
}

export function handleMessageEnd(
	runtime: ExtensionRuntime,
	event: MessageEndEvent,
): void {
	persistPrIfAvailable(runtime, textOf(event.message));
}

async function appendWorktreePrompt(
	runtime: ExtensionRuntime,
	ctx: ExtensionContext,
	messages: string[],
): Promise<void> {
	const worktree = await inspectWorktree(
		runtime.dependencies.exec ?? spawnExec,
		ctx.cwd,
	);
	const branch = worktree.branch;
	const hasWorktreeBranch = worktree.isWorktree && branch !== null;
	if (!hasWorktreeBranch) return;
	const pr = await findOpenPrSafe(
		ctx,
		branch,
		runtime.dependencies.exec ?? spawnExec,
	);
	const lookupUnavailable = pr === C.value.unknown;
	if (lookupUnavailable) {
		messages.push(C.message.lookupUnavailable);
		return;
	}
	const noOpenPr = pr === null;
	if (noOpenPr) messages.push(C.message.createPr);
}

async function buildBeforeAgentMessages(
	runtime: ExtensionRuntime,
	session: ActiveSession,
	event: BeforeAgentStartEvent,
	ctx: ExtensionContext,
): Promise<string[]> {
	const isMissingTaskRef = session.state.taskRef === undefined;
	if (isMissingTaskRef) await linkInferredTask(runtime, session, event.prompt);
	const messages: string[] = [];
	const hasHandoffContext = session.handoffContext;
	if (hasHandoffContext) {
		messages.push(
			`This is the task and PR that we were working on.\nTask: ${session.state.taskUrl ?? C.value.none}\nPR: ${session.state.prUrl ?? C.value.none}`,
		);
		session.handoffContext = false;
	}
	const isMissingTaskRefForPrompt = session.state.taskRef === undefined;
	if (isMissingTaskRefForPrompt) messages.push(MISSING_TASK_WARNING);
	const hasWorkChanged = session.workChanged;
	if (hasWorkChanged) await appendWorktreePrompt(runtime, ctx, messages);
	return messages;
}

export async function handleBeforeAgentStart(
	runtime: ExtensionRuntime,
	event: BeforeAgentStartEvent,
	ctx: ExtensionContext,
): Promise<BeforeAgentStartEventResult | undefined> {
	const session = runtime.active;
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

async function handleBashResult(
	runtime: ExtensionRuntime,
	session: ActiveSession,
	event: ToolResultEvent,
	ctx: ExtensionContext,
): Promise<void> {
	const commandValue = event.input[BASH_COMMAND];
	const command =
		typeof commandValue === STRING_TYPE ? (commandValue as string) : "";
	const resultText = textOf(event.content);
	const isMissingTaskRef = session.state.taskRef === undefined;
	if (isMissingTaskRef)
		await linkInferredTask(runtime, session, `${command}\n${resultText}`);
	const isGitMutation = GIT_MUTATION_RE.test(command);
	if (isGitMutation) session.workChanged = true;
	const prUrl = session.state.prUrl;
	const taskRef = session.state.taskRef;
	const hasPrUrl = prUrl !== undefined;
	const hasTaskRef = taskRef !== undefined;
	const hasClaimedTaskAndPr = hasPrUrl && hasTaskRef;
	if (!hasClaimedTaskAndPr) return;
	const claimedPrUrl = prUrl ?? "";
	const claimedTaskRef = taskRef ?? "";
	const stateSnapshot = structuredClone(session.state);
	const workRevision = session.workRevision;
	const isPinnedPr = await matchesPinnedPr(
		runtime.dependencies.exec ?? spawnExec,
		ctx.cwd,
		command,
		claimedPrUrl,
	);
	if (!isPinnedPr) return;
	const isCurrentMerge =
		runtime.active === session &&
		matchesWorkState(session.state, claimedTaskRef, claimedPrUrl);
	if (!isCurrentMerge) return;
	const hasCompletionAttempt =
		session.state.todoistCompletionAttemptedAt !== undefined;
	if (hasCompletionAttempt) return;
	await completeMergedTask(
		runtime,
		session,
		ctx,
		claimedTaskRef,
		stateSnapshot,
		workRevision,
	);
}

export async function handleToolResult(
	runtime: ExtensionRuntime,
	event: ToolResultEvent,
	ctx: ExtensionContext,
): Promise<void> {
	const session = runtime.active;
	const shouldIgnoreToolResult = session === null || event.isError;
	if (shouldIgnoreToolResult) return;
	if (session === null) return;
	const isEditTool = event.toolName === C.tool.edit;
	const isWriteTool = event.toolName === C.tool.write;
	const isFileMutation = isEditTool || isWriteTool;
	if (isFileMutation) session.workChanged = true;
	const isBashTool = event.toolName === C.tool.bash;
	if (isBashTool) await handleBashResult(runtime, session, event, ctx);
	const usesTaskTool = TASK_TOOL_NAMES.has(event.toolName);
	if (usesTaskTool) scheduleSync(runtime, session);
}

export function handleAgentSettled(runtime: ExtensionRuntime): void {
	const session = runtime.active;
	const hasSession = session !== null;
	if (hasSession) scheduleSync(runtime, session);
}

export async function findOpenPrSafe(
	ctx: ExtensionContext,
	branch: string,
	exec: Exec,
): Promise<string | null | "unknown"> {
	const result = await findOpenPr(exec, ctx.cwd, branch);
	const isUnknown = result.state.toLowerCase() === C.value.unknown;
	if (isUnknown) return C.value.unknown;
	return result.url;
}
