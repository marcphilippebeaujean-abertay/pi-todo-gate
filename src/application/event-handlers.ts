import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	refreshFooterStatuses,
	updateWorkingTreeStatus,
} from "../footer/module.ts";
import {
	findOpenPr,
	githubPrUrls,
	isGithubPrAvailable,
	matchesPinnedPr,
} from "../pr/module.ts";
import { type Exec, spawnExec } from "../shared/command.ts";
import { EXTENSION_CONSTANTS as C } from "../shared/constants.ts";
import type {
	BeforeAgentStartEvent,
	BeforeAgentStartResultEvent,
	MessageEndEvent,
	ToolResultEvent,
} from "../shared/events.ts";
import { createPrMergedRequest } from "../shared/events.ts";
import { textOf } from "../shared/extension-message.ts";
import { hasUncommittedChanges, inspectProject } from "../shared/project.ts";
import { isCurrentMerge } from "../shared/work-state.ts";
import type { ExtensionState, SessionContext } from "../state.ts";
import { applyStatePatch, currentSessionContext } from "../state.ts";
import { maybeAnalyzeTaskClaim } from "../todoist/module.ts";
import {
	appendState,
	initializeRemoteOrigin,
	replaceSessionState,
} from "./lifecycle.ts";

const STRING_TYPE = "string";
const GIT_MUTATION_RE =
	/\bgit\s+(add|commit|merge|rebase|checkout|switch|cherry-pick)\b/;
const BASH_COMMAND = "command";

async function ensureRemoteOrigin(
	runtime: ExtensionState,
	session: SessionContext,
): Promise<string | null> {
	const knownOrigin = session.state.remoteOrigin;
	if (knownOrigin !== undefined) return knownOrigin;
	const nextState = await initializeRemoteOrigin(
		runtime,
		session.context,
		session.state,
	);
	const isCurrentSession =
		currentSessionContext(runtime.sessionState) === session;
	if (!isCurrentSession) return null;
	replaceSessionState(session, nextState);
	return nextState.remoteOrigin ?? null;
}

async function firstAvailablePrUrl(
	runtime: ExtensionState,
	session: SessionContext,
	text: string,
): Promise<string | null> {
	const exec = runtime.dependencies.exec ?? spawnExec;
	const remoteOrigin = await ensureRemoteOrigin(runtime, session);
	if (remoteOrigin === null) return null;
	for (const url of githubPrUrls(text, remoteOrigin)) {
		const hasTestedUrl = session.prDiscoveryTestedUrls.has(url);
		if (hasTestedUrl) continue;
		session.prDiscoveryTestedUrls.add(url);
		const isAvailable = await isGithubPrAvailable(
			exec,
			session.context.cwd,
			url,
			remoteOrigin,
		);
		if (isAvailable) return url;
	}
	return null;
}

export async function persistPrIfAvailable(
	runtime: ExtensionState,
	text: string,
): Promise<void> {
	const session = currentSessionContext(runtime.sessionState);
	const hasSession = session !== null;
	if (!hasSession) return;
	const hasPrUrl = Boolean(session.state.prUrl);
	const shouldSkipPrPersistence = !session.allowPrDiscovery || hasPrUrl;
	if (shouldSkipPrPersistence) return;
	const url = await firstAvailablePrUrl(runtime, session, text);
	const hasUrl = url !== null;
	if (!hasUrl) return;
	const isCurrentSession =
		currentSessionContext(runtime.sessionState) === session;
	if (!isCurrentSession) return;
	const canDiscoverPr = session.allowPrDiscovery;
	if (!canDiscoverPr) return;
	const hasCurrentPr = session.state.prUrl !== undefined;
	if (hasCurrentPr) return;
	replaceSessionState(session, applyStatePatch(session.state, { prUrl: url }));
	session.allowPrDiscovery = false;
	appendState(runtime, session.state);
	refreshFooterStatuses(runtime.footer, session);
}

export async function handleMessageEnd(
	runtime: ExtensionState,
	event: MessageEndEvent,
): Promise<void> {
	await persistPrIfAvailable(runtime, textOf(event.message));
}

async function appendWorktreePrompt(
	runtime: ExtensionState,
	ctx: ExtensionContext,
	messages: string[],
): Promise<void> {
	const worktree = await inspectProject(
		runtime.dependencies.exec ?? spawnExec,
		ctx.cwd,
	);
	const branch = worktree.branch;
	const remoteOrigin = worktree.remoteOrigin;
	const hasRemoteOrigin = remoteOrigin !== null;
	const hasWorktreeBranch = worktree.isWorktree && branch !== null;
	const canDetectWorktreePr = hasWorktreeBranch && hasRemoteOrigin;
	if (!canDetectWorktreePr) return;
	const pr = await findOpenPrSafe(
		ctx,
		branch,
		runtime.dependencies.exec ?? spawnExec,
		remoteOrigin,
	);
	switch (pr) {
		case C.value.unknown:
			messages.push(C.message.lookupUnavailable);
			return;
		case null:
			messages.push(C.message.createPr);
	}
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
	if (hasWorkChanged) await appendWorktreePrompt(runtime, ctx, messages);
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

async function handleBashResult(
	runtime: ExtensionState,
	session: SessionContext,
	event: ToolResultEvent,
	ctx: ExtensionContext,
): Promise<void> {
	const commandValue = event.input[BASH_COMMAND];
	const command =
		typeof commandValue === STRING_TYPE
			? (commandValue as string)
			: C.worktree.empty;
	const isGitMutation = GIT_MUTATION_RE.test(command);
	if (isGitMutation) session.workChanged = true;
	const prUrl = session.state.prUrl;
	const hasPrUrl = prUrl !== undefined;
	if (!hasPrUrl) return;
	const claimedPrUrl = prUrl;
	const claimedTaskRef = session.state.taskRef;
	const mergeWorkRevision = session.workRevision;
	const mergeOperationGeneration = session.operationGeneration;
	const isPinnedPr = await matchesPinnedPr(
		runtime.dependencies.exec ?? spawnExec,
		ctx.cwd,
		command,
		claimedPrUrl,
	);
	if (!isPinnedPr) return;
	const currentMerge = isCurrentMerge(
		runtime,
		session,
		mergeWorkRevision,
		mergeOperationGeneration,
		claimedTaskRef,
		claimedPrUrl,
	);
	if (!currentMerge) return;
	await runtime.eventHandler.prMergeRequestedEvent.emit(
		createPrMergedRequest({
			prUrl: claimedPrUrl,
			taskMarkedAsCompleted: false,
		}),
	);
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
	if (isBashTool) await handleBashResult(runtime, session, event, ctx);
	const shouldRefreshWorkingTreeStatus = isFileMutation || isBashTool;
	if (!shouldRefreshWorkingTreeStatus) return;
	const workingTreeStatus = await hasUncommittedChanges(
		runtime.dependencies.exec ?? spawnExec,
		ctx.cwd,
	);
	if (workingTreeStatus === null) return;
	updateWorkingTreeStatus(runtime.footer, session, workingTreeStatus);
}

export async function findOpenPrSafe(
	ctx: ExtensionContext,
	branch: string,
	exec: Exec,
	remoteOrigin: string | null,
): Promise<string | null | "unknown"> {
	const result = await findOpenPr(exec, ctx.cwd, branch, remoteOrigin);
	const isUnknown = result.state.toLowerCase() === C.value.unknown;
	if (isUnknown) return C.value.unknown;
	return result.url;
}
