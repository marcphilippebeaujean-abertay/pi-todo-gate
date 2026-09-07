import { fileURLToPath } from "node:url";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { EXTENSION_CONSTANTS as C } from "./constants.ts";
import type { ActiveSession, ExtensionRuntime } from "./extension-types.ts";
import { mergePinnedPr } from "./pr/module.ts";
import {
	enqueueSessionOperation,
	isCurrentOperation,
} from "./session-operations.ts";
import { type CommandResult, spawnExec } from "./shared/command.ts";

const MERGE_COMMAND = "merge";
const CONFIRM_TITLE_PREFIX = "Merge PR ";
const CONFIRM_MESSAGE = "Confirm merge of pinned pull request.";
const NO_PR_MESSAGE = "No pinned pull request is available to merge";
const INACTIVE_MESSAGE = "Merge protocol is inactive for this project";
const NO_UI_MESSAGE = "Merge protocol requires an interactive UI";
const MERGE_FAILED_PREFIX = "Pull request merge failed";
const MERGE_SUCCEEDED = "Pull request merged";
const MAX_ERROR_LENGTH = 200;

export const mergeProtocolSkillPath = fileURLToPath(
	new URL("../skills/merge-protocol", import.meta.url),
);

function currentSession(
	runtime: ExtensionRuntime,
	session: ActiveSession,
	generation: number,
): boolean {
	return runtime.active === session && isCurrentOperation(session, generation);
}

function failureDetail(stderr: string): string {
	return stderr.replace(/\s+/g, " ").trim().slice(0, MAX_ERROR_LENGTH);
}

async function mergeNow(
	runtime: ExtensionRuntime,
	session: ActiveSession,
	ctx: ExtensionCommandContext,
	prUrl: string,
	generation: number,
): Promise<void> {
	const isCurrentBeforeCommand = currentSession(runtime, session, generation);
	if (!isCurrentBeforeCommand) return;
	const exec = runtime.dependencies.exec ?? spawnExec;
	let result: CommandResult;
	try {
		result = await mergePinnedPr(exec, session.context.cwd, prUrl);
	} catch (error) {
		const isCurrentAfterFailure = currentSession(runtime, session, generation);
		if (!isCurrentAfterFailure) return;
		const detail = failureDetail(
			error instanceof Error ? error.message : String(error),
		);
		const hasDetail = detail !== "";
		const suffix = hasDetail ? `: ${detail}` : "";
		ctx.ui.notify(`${MERGE_FAILED_PREFIX}${suffix}`, C.value.warning);
		return;
	}
	const isCurrentAfterCommand = currentSession(runtime, session, generation);
	if (!isCurrentAfterCommand) return;
	const commandFailed = result.code !== 0;
	if (commandFailed) {
		const detail = failureDetail(result.stderr);
		const hasDetail = detail !== "";
		const suffix = hasDetail ? `: ${detail}` : "";
		ctx.ui.notify(`${MERGE_FAILED_PREFIX}${suffix}`, C.value.warning);
		return;
	}
	await runtime.events.emit(C.event.prMerged, {
		prUrl,
		taskMarkedAsCompleted: false,
	});
	const isCurrentAfterEvent = currentSession(runtime, session, generation);
	if (isCurrentAfterEvent) {
		ctx.ui.notify(MERGE_SUCCEEDED, C.value.info);
	}
}

async function confirmAndMerge(
	runtime: ExtensionRuntime,
	session: ActiveSession,
	ctx: ExtensionCommandContext,
	prUrl: string,
	generation: number,
): Promise<void> {
	const confirmed = await ctx.ui.confirm(
		`${CONFIRM_TITLE_PREFIX}${prUrl}?`,
		CONFIRM_MESSAGE,
	);
	if (!confirmed) return;
	const isCurrentAfterConfirmation = currentSession(
		runtime,
		session,
		generation,
	);
	if (!isCurrentAfterConfirmation) return;
	await mergeNow(runtime, session, ctx, prUrl, generation);
}

export async function runMergeProtocol(
	runtime: ExtensionRuntime,
	ctx: ExtensionCommandContext,
): Promise<void> {
	const session = runtime.active;
	if (session === null) {
		ctx.ui.notify(INACTIVE_MESSAGE, C.value.warning);
		return;
	}
	const hasInteractiveUi = ctx.hasUI && session.context.hasUI;
	if (!hasInteractiveUi) {
		ctx.ui.notify(NO_UI_MESSAGE, C.value.warning);
		return;
	}
	const prUrl = session.state.prUrl;
	const hasPinnedPr = typeof prUrl === "string" && prUrl.trim() !== "";
	if (!hasPinnedPr) {
		ctx.ui.notify(NO_PR_MESSAGE, C.value.warning);
		return;
	}
	const generation = session.operationGeneration;
	await enqueueSessionOperation(
		session,
		confirmAndMerge.bind(null, runtime, session, ctx, prUrl, generation),
	);
}

export function registerMergeProtocol(
	pi: ExtensionAPI,
	runtime: ExtensionRuntime,
): void {
	pi.on("resources_discover", () => ({
		skillPaths: [mergeProtocolSkillPath],
	}));
	if (typeof pi.registerCommand !== "function") return;
	pi.registerCommand(MERGE_COMMAND, {
		description: "Merge the active session's pinned pull request",
		handler: (_args, ctx) => runMergeProtocol(runtime, ctx),
	});
}
