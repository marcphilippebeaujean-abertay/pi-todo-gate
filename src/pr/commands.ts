import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import type { CommandResult } from "../shared/command.ts";
import { spawnExec } from "../shared/command.ts";
import {
	MERGE_COMMAND as MERGE_PROTOCOL_COMMAND,
	mergeProtocolSkillPath,
} from "./constants.ts";
import { mergePinnedPr } from "./git.ts";
import {
	notifyInactive,
	notifyMergeFailure,
	notifyMergeSucceeded,
	notifyNoPr,
	notifyNoUi,
} from "./notifications.ts";
import type { PrCommandDependencies, PrSession } from "./state.ts";
import { confirmMerge } from "./user-prompts.ts";

function currentSession(
	runtime: PrCommandDependencies,
	session: PrSession,
	generation: number,
): boolean {
	const activeSession = runtime.getSession();
	const current =
		activeSession?.sessionId === session.sessionId &&
		runtime.isCurrentOperation(session, generation);
	return runtime.sessionState.sessionId === session.sessionId && current;
}

function failureDetail(stderr: string): string {
	return stderr.replace(/\s+/g, " ").trim().slice(0, 200);
}

async function mergeNow(
	runtime: PrCommandDependencies,
	session: PrSession,
	ctx: ExtensionCommandContext,
	prUrl: string,
	generation: number,
): Promise<boolean> {
	const isCurrentBeforeCommand = currentSession(runtime, session, generation);
	if (!isCurrentBeforeCommand) return false;
	const exec = runtime.exec ?? spawnExec;
	let result: CommandResult;
	try {
		result = await mergePinnedPr(exec, session.context.cwd, prUrl);
	} catch (error) {
		const isCurrentAfterFailure = currentSession(runtime, session, generation);
		if (!isCurrentAfterFailure) return false;
		const detail = failureDetail(
			error instanceof Error ? error.message : String(error),
		);
		notifyMergeFailure(ctx, detail);
		return false;
	}
	const isCurrentAfterCommand = currentSession(runtime, session, generation);
	if (!isCurrentAfterCommand) return false;
	const commandFailed = result.code !== 0;
	if (commandFailed) {
		notifyMergeFailure(ctx, failureDetail(result.stderr));
		return false;
	}
	return true;
}

async function confirmAndMerge(
	runtime: PrCommandDependencies,
	session: PrSession,
	ctx: ExtensionCommandContext,
	prUrl: string,
	generation: number,
): Promise<boolean> {
	const confirmed = await confirmMerge(ctx, prUrl);
	if (!confirmed) return false;
	const isCurrentAfterConfirm = currentSession(runtime, session, generation);
	if (!isCurrentAfterConfirm) return false;
	return mergeNow(runtime, session, ctx, prUrl, generation);
}

async function runMergeProtocol(
	runtime: PrCommandDependencies,
	ctx: ExtensionCommandContext,
): Promise<void> {
	const session = runtime.getSession();
	const hasSession = session !== null;
	if (!hasSession) {
		notifyInactive(ctx);
		return;
	}
	const hasInteractiveUi = ctx.hasUI && session.context.hasUI;
	if (!hasInteractiveUi) {
		notifyNoUi(ctx);
		return;
	}
	const prUrl = session.state.prUrl;
	const hasPrUrl = typeof prUrl === "string" && prUrl.trim() !== "";
	if (!hasPrUrl) {
		notifyNoPr(ctx);
		return;
	}
	const generation = runtime.getPrState().operationGeneration ?? 0;
	const enqueue = runtime.enqueueSessionOperation;
	const merged = await enqueue(
		session,
		confirmAndMerge.bind(null, runtime, session, ctx, prUrl, generation),
	);
	const isCurrentAfterMerge = currentSession(runtime, session, generation);
	const shouldStop = !merged || !isCurrentAfterMerge;
	if (shouldStop) return;
	await runtime.eventHandler.prMergedEvent.emit({
		prUrl,
		taskMarkedAsCompleted: false,
	});
	const isCurrentAfterEmit = currentSession(runtime, session, generation);
	if (isCurrentAfterEmit) notifyMergeSucceeded(ctx);
}

export function register(
	pi: ExtensionAPI,
	runtime: PrCommandDependencies,
): void {
	pi.on("resources_discover", () => ({
		skillPaths: [mergeProtocolSkillPath],
	}));
	if (typeof pi.registerCommand !== "function") return;
	pi.registerCommand(MERGE_PROTOCOL_COMMAND, {
		description: "Merge the active session's pinned pull request",
		handler: (_args, ctx) => runMergeProtocol(runtime, ctx),
	});
}
