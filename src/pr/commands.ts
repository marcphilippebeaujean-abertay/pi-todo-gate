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
import type { PrCommandOptions, PrSession } from "./internal-state.ts";
import {
	notifyInactive,
	notifyMergeFailure,
	notifyMergeSucceeded,
	notifyNoPr,
	notifyNoUi,
} from "./notifications.ts";
import { confirmMerge } from "./user-prompts.ts";

function currentSession(
	dependencies: PrCommandOptions,
	session: PrSession,
	sessionId: string,
): boolean {
	const activeSession = dependencies.getSession();
	const current =
		activeSession === session &&
		dependencies.isCurrentSession(session, sessionId);
	return dependencies.sessionState.session.activeSessionId !== null && current;
}

function failureDetail(stderr: string): string {
	return stderr.replace(/\s+/g, " ").trim().slice(0, 200);
}

async function mergeNow(
	dependencies: PrCommandOptions,
	session: PrSession,
	ctx: ExtensionCommandContext,
	prUrl: string,
	sessionId: string,
): Promise<boolean> {
	const isCurrentBeforeCommand = currentSession(
		dependencies,
		session,
		sessionId,
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
			sessionId,
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
		sessionId,
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
	sessionId: string,
): Promise<boolean> {
	const confirmed = await confirmMerge(ctx, prUrl);
	if (!confirmed) return false;
	const isCurrentAfterConfirm = currentSession(
		dependencies,
		session,
		sessionId,
	);
	if (!isCurrentAfterConfirm) return false;
	return mergeNow(dependencies, session, ctx, prUrl, sessionId);
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
	const prUrl = dependencies.sessionState.moduleState.pr.prUrl;
	const hasPrUrl = typeof prUrl === "string" && prUrl.trim() !== "";
	if (!hasPrUrl) {
		notifyNoPr(ctx);
		return;
	}
	const sessionId = session.sessionId;
	const enqueue = dependencies.enqueueSessionOperation;
	const merged = await enqueue(
		session,
		confirmAndMerge.bind(null, dependencies, session, ctx, prUrl, sessionId),
	);
	const isCurrentAfterMerge = currentSession(dependencies, session, sessionId);
	const shouldStop = !merged || !isCurrentAfterMerge;
	if (shouldStop) return;
	await dependencies.eventHandler.prMergedEvent.emit({
		prUrl,
		taskMarkedAsCompleted: false,
		sessionId,
	});
	const isCurrentAfterEmit = currentSession(dependencies, session, sessionId);
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
