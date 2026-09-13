import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type Exec, spawnExec } from "../shared/command.ts";
import { EXTENSION_CONSTANTS as C } from "../shared/constants.ts";
import type { ToolResultEvent } from "../shared/events.ts";
import type { SessionState } from "../state.ts";
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
	operationGeneration: number,
	currentOperationGeneration: number,
	taskRef: string | undefined,
	prUrl: string,
): boolean {
	const isActive = sessionState.session.activeSessionId !== null;
	const hasSameRevision = session.workRevision === workRevision;
	const hasSamePrGeneration =
		operationGeneration === currentOperationGeneration;
	const hasSameTask = sessionState.moduleState.todoist.taskRef === taskRef;
	const hasSamePr = prState.prUrl === prUrl;
	const sameMergeIdentity = hasSameTask && hasSamePr;
	const sameOperation = hasSameRevision && hasSamePrGeneration;
	return isActive && sameOperation && sameMergeIdentity;
}

async function emitCurrentMerge(
	getSession: () => PrSession | null,
	sessionState: SessionState,
	prState: PrState,
	session: PrSession,
	context: ExtensionContext,
	workRevision: number,
	operationGeneration: number,
	currentOperationGeneration: number,
	taskRef: string | undefined,
	prUrl: string,
	emitMerged: (prUrl: string) => Promise<void>,
): Promise<void> {
	if (!isCurrentPrContext(getSession, session, context)) return;
	const currentMerge = isCurrentMerge(
		sessionState,
		prState,
		session,
		workRevision,
		operationGeneration,
		currentOperationGeneration,
		taskRef,
		prUrl,
	);
	if (currentMerge) await emitMerged(prUrl);
}

export async function handlePrToolResult(
	getSession: () => PrSession | null,
	sessionState: SessionState,
	prState: PrState,
	operationGeneration: number,
	currentOperationGeneration: number,
	event: ToolResultEvent,
	ctx: ExtensionContext,
	emitMerged: (prUrl: string) => Promise<void>,
	exec?: Exec,
): Promise<void> {
	const commandExec = exec ?? spawnExec;
	const shouldIgnoreEvent = event.isError || event.toolName !== C.tool.bash;
	if (shouldIgnoreEvent) return;
	const session = getSession();
	if (session === null || !isCurrentPrContext(getSession, session, ctx)) return;
	const command = bashCommand(event);
	if (GIT_MUTATION_RE.test(command)) session.hasPerformedAnyGitMutations = true;
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
		operationGeneration,
		currentOperationGeneration,
		taskRef,
		prUrl,
		emitMerged,
	);
}
