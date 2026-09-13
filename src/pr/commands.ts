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
import type { PrCommandOptions, PrSession } from "./state.ts";
import { confirmMerge } from "./user-prompts.ts";

function currentSession(
	dependencies: PrCommandOptions,
	session: PrSession,
	generation: number,
): boolean {
	const activeSession = dependencies.getSession();
	const current =
		activeSession?.sessionId === session.sessionId &&
		dependencies.isCurrentOperation(session, generation);
	return dependencies.sessionState.sessionId === session.sessionId && current;
}

function failureDetail(stderr: string): string {
	return stderr.replace(/\s+/g, " ").trim().slice(0, 200);
}

async function mergeNow(
	dependencies: PrCommandOptions,
	session: PrSession,
	ctx: ExtensionCommandContext,
	prUrl: string,
	generation: number,
): Promise<boolean> {
	const isCurrentBeforeCommand = currentSession(
		dependencies,
		session,
		generation,
	);
	if (!isCurrentBeforeCommand) return false;
	const exec = dependencies.exec ?? spawnExec;
	let result: CommandResult;
	try {
		result = await mergePinnedPr(exec, session.context.cwd, prUrl);
	} catch (error) {
		const isCurrentAfterFailure = currentSession(
			dependencies,
			session,
			generation,
		);
		if (!isCurrentAfterFailure) return false;
		const detail = failureDetail(
			error instanceof Error ? error.message : String(error),
		);
		notifyMergeFailure(ctx, detail);
		return false;
	}
	const isCurrentAfterCommand = currentSession(
		dependencies,
		session,
		generation,
	);
	if (!isCurrentAfterCommand) return false;
	const commandFailed = result.code !== 0;
	if (commandFailed) {
		notifyMergeFailure(ctx, failureDetail(result.stderr));
		return false;
	}
	return true;
}

async function confirmAndMerge(
	dependencies: PrCommandOptions,
	session: PrSession,
	ctx: ExtensionCommandContext,
	prUrl: string,
	generation: number,
): Promise<boolean> {
	const confirmed = await confirmMerge(ctx, prUrl);
	if (!confirmed) return false;
	const isCurrentAfterConfirm = currentSession(
		dependencies,
		session,
		generation,
	);
	if (!isCurrentAfterConfirm) return false;
	return mergeNow(dependencies, session, ctx, prUrl, generation);
}

async function runMergeProtocol(
	dependencies: PrCommandOptions,
	ctx: ExtensionCommandContext,
): Promise<void> {
	const session = dependencies.getSession();
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
	const generation = dependencies.getPrState().operationGeneration ?? 0;
	const enqueue = dependencies.enqueueSessionOperation;
	const merged = await enqueue(
		session,
		confirmAndMerge.bind(null, dependencies, session, ctx, prUrl, generation),
	);
	const isCurrentAfterMerge = currentSession(dependencies, session, generation);
	const shouldStop = !merged || !isCurrentAfterMerge;
	if (shouldStop) return;
	await dependencies.eventHandler.prMergedEvent.emit({
		prUrl,
		taskMarkedAsCompleted: false,
	});
	const isCurrentAfterEmit = currentSession(dependencies, session, generation);
	if (isCurrentAfterEmit) notifyMergeSucceeded(ctx);
}

export function register(
	pi: ExtensionAPI,
	dependencies: PrCommandOptions,
): void {
	pi.on("resources_discover", () => ({
		skillPaths: [mergeProtocolSkillPath],
	}));
	if (typeof pi.registerCommand !== "function") return;
	pi.registerCommand(MERGE_PROTOCOL_COMMAND, {
		description: "Merge the active session's pinned pull request",
		handler: (_args, ctx) => runMergeProtocol(dependencies, ctx),
	});
}
