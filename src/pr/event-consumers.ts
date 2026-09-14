import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type Exec, spawnExec } from "../shared/command.ts";
import { EXTENSION_CONSTANTS as C } from "../shared/constants.ts";
import type { ToolResultEvent } from "../shared/events.ts";
import type { SessionState } from "../state.ts";
import { matchesPinnedPr } from "./event-publishers.ts";
import type { PrSession, PrState } from "./internal-state.ts";

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
	return currentSession === session && session.context === context;
}

function bashCommand(event: ToolResultEvent): string {
	const commandValue = event.input[BASH_COMMAND];
	return typeof commandValue === STRING_TYPE
		? String(commandValue)
		: C.worktree.empty;
}

export function isCurrentMerge(
	sessionState: SessionState,
	prState: PrState,
	session: PrSession,
	workRevision: number,
	sessionId: string,
	currentSessionId: string,
	taskRef: string | undefined,
	prUrl: string,
): boolean {
	const isActive = sessionState.session.activeSessionId !== null;
	const hasSameRevision = session.workRevision === workRevision;
	const hasSameSession = sessionId === currentSessionId;
	const hasSameTask = sessionState.moduleState.todoist.taskRef === taskRef;
	const hasSamePr = prState.prUrl === prUrl;
	const sameMergeIdentity = hasSameTask && hasSamePr;
	const sameSessionAndRevision = hasSameRevision && hasSameSession;
	const identityChecks = [isActive, sameSessionAndRevision, sameMergeIdentity];
	return identityChecks.every(Boolean);
}

async function emitCurrentMerge(
	getSession: () => PrSession | null,
	sessionState: SessionState,
	prState: PrState,
	session: PrSession,
	context: ExtensionContext,
	workRevision: number,
	sessionId: string,
	currentSessionId: string,
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
		sessionId,
		currentSessionId,
		taskRef,
		prUrl,
	);
	if (currentMerge) await emitMerged(prUrl);
}

export async function handlePrToolResult(
	getSession: () => PrSession | null,
	sessionState: SessionState,
	prState: PrState,
	sessionId: string,
	currentSessionId: string,
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
	if (!hasSession) return;
	const isCurrentContext = isCurrentPrContext(getSession, session, ctx);
	if (!isCurrentContext) return;
	const command = bashCommand(event);
	const isGitMutation = GIT_MUTATION_RE.test(command);
	if (isGitMutation) session.hasPerformedAnyGitMutations = true;
	const prUrl = prState.prUrl;
	if (prUrl === undefined) return;
	const taskRef = sessionState.moduleState.todoist.taskRef;
	const isPinnedPr = await matchesPinnedPr(
		commandExec,
		ctx.cwd,
		command,
		prUrl,
	);
	if (!isPinnedPr) return;
	await emitCurrentMerge(
		getSession,
		sessionState,
		prState,
		session,
		ctx,
		session.workRevision,
		sessionId,
		currentSessionId,
		taskRef,
		prUrl,
		emitMerged,
	);
}
