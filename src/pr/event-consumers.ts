import { fileURLToPath } from "node:url";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { EXTENSION_CONSTANTS as C } from "../constants.ts";
import type { CommandResult, Exec } from "../shared/command.ts";
import { spawnExec } from "../shared/command.ts";
import { mergePinnedPr } from "./commands.ts";
import {
	MAX_ERROR_LENGTH,
	MERGE_COMMAND as MERGE_PROTOCOL_COMMAND,
} from "./constants.ts";
import {
	notifyInactive,
	notifyMergeFailure,
	notifyMergeSucceeded,
	notifyNoPr,
	notifyNoUi,
} from "./notifications.ts";
import { confirmMerge } from "./user-prompts.ts";

export const mergeProtocolSkillPath = fileURLToPath(
	new URL("../../skills/merge-protocol", import.meta.url),
);

interface PrSession {
	context: { cwd: string; hasUI: boolean };
	state: { prUrl?: string };
	operationGeneration: number;
	operationQueue?: Promise<void>;
}

type PrRuntime = {
	active: PrSession | null;
	dependencies: { exec?: Exec };
	events: {
		emit(
			event: string,
			payload: { prUrl: string; taskMarkedAsCompleted: boolean },
		): Promise<void>;
	};
	isCurrentOperation?(session: PrSession, generation: number): boolean;
	enqueueSessionOperation?<T>(
		session: PrSession,
		operation: () => Promise<T>,
	): Promise<T>;
};

function currentSession(
	runtime: PrRuntime,
	session: PrSession,
	generation: number,
): boolean {
	const current =
		runtime.isCurrentOperation?.(session, generation) ??
		session.operationGeneration === generation;
	return runtime.active === session && current;
}

function enqueueOperation<T>(
	session: PrSession,
	operation: () => Promise<T>,
): Promise<T> {
	const previous = session.operationQueue ?? Promise.resolve();
	const result = previous.then(operation);
	session.operationQueue = result.then(() => undefined);
	return result;
}

function failureDetail(stderr: string): string {
	return stderr.replace(/\s+/g, " ").trim().slice(0, MAX_ERROR_LENGTH);
}

async function mergeNow(
	runtime: PrRuntime,
	session: PrSession,
	ctx: ExtensionCommandContext,
	prUrl: string,
	generation: number,
): Promise<boolean> {
	const isCurrentBeforeCommand = currentSession(runtime, session, generation);
	if (!isCurrentBeforeCommand) return false;
	const exec = runtime.dependencies.exec ?? spawnExec;
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
		const detail = failureDetail(result.stderr);
		notifyMergeFailure(ctx, detail);
		return false;
	}
	return true;
}

async function confirmAndMerge(
	runtime: PrRuntime,
	session: PrSession,
	ctx: ExtensionCommandContext,
	prUrl: string,
	generation: number,
): Promise<boolean> {
	const confirmed = await confirmMerge(ctx, prUrl);
	if (!confirmed) return false;
	const isCurrentAfterConfirmation = currentSession(
		runtime,
		session,
		generation,
	);
	if (!isCurrentAfterConfirmation) return false;
	return mergeNow(runtime, session, ctx, prUrl, generation);
}

export async function runMergeProtocol(
	runtime: PrRuntime,
	ctx: ExtensionCommandContext,
): Promise<void> {
	const session = runtime.active;
	if (session === null) {
		notifyInactive(ctx);
		return;
	}
	const hasInteractiveUi = ctx.hasUI && session.context.hasUI;
	if (!hasInteractiveUi) {
		notifyNoUi(ctx);
		return;
	}
	const prUrl = session.state.prUrl;
	const hasPinnedPr = typeof prUrl === "string" && prUrl.trim() !== "";
	if (!hasPinnedPr) {
		notifyNoPr(ctx);
		return;
	}
	const generation = session.operationGeneration;
	const merged = await (runtime.enqueueSessionOperation ?? enqueueOperation)(
		session,
		confirmAndMerge.bind(null, runtime, session, ctx, prUrl, generation),
	);
	if (!merged) return;
	const isCurrentAfterMerge = currentSession(runtime, session, generation);
	if (!isCurrentAfterMerge) return;
	await runtime.events.emit(C.event.prMerged, {
		prUrl,
		taskMarkedAsCompleted: false,
	});
	const isCurrentAfterEvent = currentSession(runtime, session, generation);
	if (isCurrentAfterEvent) notifyMergeSucceeded(ctx);
}

export function registerMergeProtocol(
	pi: ExtensionAPI,
	runtime: PrRuntime,
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
