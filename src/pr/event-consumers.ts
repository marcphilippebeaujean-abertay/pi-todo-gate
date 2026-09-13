import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type Exec, spawnExec } from "../shared/command.ts";
import { EXTENSION_CONSTANTS as C } from "../shared/constants.ts";
import type { ToolResultEvent } from "../shared/events.ts";
import { matchesPinnedPr } from "./event-publishers.ts";
import type { PrSession, PrState } from "./state.ts";

const STRING_TYPE = "string";
const BASH_COMMAND = "command";
const GIT_MUTATION_RE =
	/\bgit\s+(add|commit|merge|rebase|checkout|switch|cherry-pick)\b/;

function isCurrentPrContext(
	getSession: () => PrSession | null,
	session: PrSession,
	context: ExtensionContext,
): boolean {
	const currentSession = getSession();
	const sessionContext = session.context;
	return currentSession === session && sessionContext === context;
}

function bashCommand(event: ToolResultEvent): string {
	const commandValue = event.input[BASH_COMMAND];
	return typeof commandValue === STRING_TYPE
		? String(commandValue)
		: C.worktree.empty;
}

export function isCurrentMerge(
	sessionState: { sessionId: string | null },
	prState: PrState,
	session: PrSession,
	workRevision: number,
	operationGeneration: number,
	taskRef: string | undefined,
	prUrl: string,
): boolean {
	const isActive = sessionState.sessionId === session.sessionId;
	const hasSameRevision = session.workRevision === workRevision;
	const hasSameGeneration = prState.operationGeneration === operationGeneration;
	const hasSameTask = session.state.taskRef === taskRef;
	const hasSamePr = session.state.prUrl === prUrl;
	const sameMergeIdentity = hasSameTask && hasSamePr;
	const sameOperation = hasSameRevision && hasSameGeneration;
	const activeCurrentOperation = isActive && sameOperation;
	return activeCurrentOperation && sameMergeIdentity;
}

async function emitCurrentMerge(
	getSession: () => PrSession | null,
	sessionState: { sessionId: string | null },
	prState: PrState,
	session: PrSession,
	context: ExtensionContext,
	workRevision: number,
	operationGeneration: number,
	taskRef: string | undefined,
	prUrl: string,
	emitMerged: (prUrl: string) => Promise<void>,
): Promise<void> {
	const isCurrentContext = isCurrentPrContext(getSession, session, context);
	if (!isCurrentContext) return;
	const currentMerge = isCurrentMerge(
		sessionState,
		prState,
		session,
		workRevision,
		operationGeneration,
		taskRef,
		prUrl,
	);
	if (currentMerge) await emitMerged(prUrl);
}

export async function handlePrToolResult(
	getSession: () => PrSession | null,
	sessionState: { sessionId: string | null },
	prState: PrState,
	event: ToolResultEvent,
	ctx: ExtensionContext,
	emitMerged: (prUrl: string) => Promise<void>,
	exec?: Exec,
): Promise<void> {
	const commandExec = exec ?? spawnExec;
	const shouldIgnoreEvent = event.isError || event.toolName !== C.tool.bash;
	if (shouldIgnoreEvent) return;
	const session = getSession();
	const hasSession = session !== null;
	const hasCurrentContext =
		hasSession && isCurrentPrContext(getSession, session, ctx);
	const canHandleSession = hasCurrentContext && session !== null;
	if (!canHandleSession) return;
	const command = bashCommand(event);
	const isGitMutation = GIT_MUTATION_RE.test(command);
	if (isGitMutation) session.workChanged = true;
	const prUrl = session.state.prUrl;
	if (prUrl === undefined) return;
	const claimedPrUrl = prUrl;
	const claimedTaskRef = session.state.taskRef;
	const mergeWorkRevision = session.workRevision;
	const mergeOperationGeneration = prState.operationGeneration ?? 0;
	const isPinnedPr = await matchesPinnedPr(
		commandExec,
		ctx.cwd,
		command,
		claimedPrUrl,
	);
	if (!isPinnedPr) return;
	await emitCurrentMerge(
		getSession,
		sessionState,
		prState,
		session,
		ctx,
		mergeWorkRevision,
		mergeOperationGeneration,
		claimedTaskRef,
		claimedPrUrl,
		emitMerged,
	);
}
