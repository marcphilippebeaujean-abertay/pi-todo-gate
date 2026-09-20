import { randomUUID } from "node:crypto";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import {
	boundHerdrClient,
	currentPaneId,
	HERDR_COMMAND,
} from "../shared/herdr-client.ts";
import {
	AGENT,
	ARGUMENT_SEPARATOR,
	CWD_FLAG,
	DIRECTION_FLAG,
	FOCUS_FLAG,
	KIND_FLAG,
	MATCH_FLAG,
	PANE,
	PANE_FLAG,
	PANE_RUN,
	PROMPT,
	RECENT_UNWRAPPED,
	REVIEW_AGENT_KIND,
	REVIEW_AGENT_NAME_PREFIX,
	REVIEW_AGENT_NO_EXTENSIONS,
	REVIEW_AGENT_WAIT_TIMEOUT,
	REVIEW_COMMAND,
	REVIEW_DESCRIPTION,
	REVIEW_FAILED,
	REVIEW_NO_PANE,
	REVIEW_NO_PR,
	REVIEW_PANE_DIRECTION,
	REVIEW_PROMPT_MIDDLE,
	REVIEW_PROMPT_PREFIX,
	REVIEW_PROMPT_SUFFIX,
	REVIEW_SHELL_READY_MARKER,
	REVIEW_SHELL_READY_TIMEOUT,
	SOURCE_FLAG,
	SPLIT,
	START,
	TIMEOUT_FLAG,
	WAIT,
	WAIT_OUTPUT,
	WARNING,
} from "./constants.ts";
import type { ReviewCommandDependencies } from "./internal-state.ts";

function notify(context: ExtensionCommandContext, message: string): void {
	const hasNoUI = !context.hasUI;
	if (hasNoUI) return;
	context.ui.notify(message, WARNING);
}

function paneIdFrom(output: string): string {
	let parsed: unknown;
	try {
		parsed = JSON.parse(output);
	} catch {
		throw new Error(REVIEW_NO_PANE);
	}
	const isParsedRecord = typeof parsed === "object" && parsed !== null;
	if (!isParsedRecord) throw new Error(REVIEW_NO_PANE);
	const result = (parsed as { result?: unknown }).result;
	const isResultRecord = typeof result === "object" && result !== null;
	if (!isResultRecord) throw new Error(REVIEW_NO_PANE);
	const pane = (result as { pane?: unknown }).pane;
	const isPaneRecord = typeof pane === "object" && pane !== null;
	if (!isPaneRecord) throw new Error(REVIEW_NO_PANE);
	const paneId = (pane as { pane_id?: unknown }).pane_id;
	const isValidPaneId = typeof paneId === "string" && paneId.trim() !== "";
	if (!isValidPaneId) throw new Error(REVIEW_NO_PANE);
	return paneId;
}

function reviewPrompt(prUrl: string, worktreePath: string): string {
	return `${REVIEW_PROMPT_PREFIX}${prUrl}${REVIEW_PROMPT_MIDDLE}${worktreePath}${REVIEW_PROMPT_SUFFIX}`;
}

function reviewAgentName(): string {
	const suffix = randomUUID().replace(/-/g, "").slice(0, 8);
	return `${REVIEW_AGENT_NAME_PREFIX}-${suffix}`;
}

function waitForPaneShell(
	herdrClient: NonNullable<ReviewCommandDependencies["herdrClient"]>,
	paneId: string,
): void {
	herdrClient(HERDR_COMMAND, [
		PANE,
		PANE_RUN,
		paneId,
		`echo ${REVIEW_SHELL_READY_MARKER}`,
	]);
	herdrClient(HERDR_COMMAND, [
		PANE,
		WAIT_OUTPUT,
		paneId,
		MATCH_FLAG,
		REVIEW_SHELL_READY_MARKER,
		SOURCE_FLAG,
		RECENT_UNWRAPPED,
		TIMEOUT_FLAG,
		REVIEW_SHELL_READY_TIMEOUT,
	]);
}

function startReviewAgent(
	herdrClient: NonNullable<ReviewCommandDependencies["herdrClient"]>,
	agentName: string,
	paneId: string,
): void {
	try {
		herdrClient(HERDR_COMMAND, [
			AGENT,
			START,
			agentName,
			KIND_FLAG,
			REVIEW_AGENT_KIND,
			PANE_FLAG,
			paneId,
			ARGUMENT_SEPARATOR,
			REVIEW_AGENT_NO_EXTENSIONS,
		]);
	} catch {
		herdrClient(HERDR_COMMAND, [
			AGENT,
			WAIT,
			agentName,
			TIMEOUT_FLAG,
			REVIEW_AGENT_WAIT_TIMEOUT,
		]);
	}
}

function openReviewPane(
	client: ReviewCommandDependencies["herdrClient"],
	prUrl: string,
	worktreePath: string,
): void {
	const herdrClient = client ?? boundHerdrClient(worktreePath);
	const sourcePaneId = currentPaneId();
	const hasSourcePaneId = sourcePaneId !== undefined;
	if (!hasSourcePaneId) throw new Error(REVIEW_NO_PANE);
	const splitOutput = herdrClient(HERDR_COMMAND, [
		PANE,
		SPLIT,
		sourcePaneId,
		DIRECTION_FLAG,
		REVIEW_PANE_DIRECTION,
		CWD_FLAG,
		worktreePath,
		FOCUS_FLAG,
	]);
	const paneId = paneIdFrom(splitOutput);
	waitForPaneShell(herdrClient, paneId);
	const agentName = reviewAgentName();
	startReviewAgent(herdrClient, agentName, paneId);
	herdrClient(HERDR_COMMAND, [
		AGENT,
		PROMPT,
		agentName,
		reviewPrompt(prUrl, worktreePath),
	]);
}

async function runReview(
	dependencies: ReviewCommandDependencies,
	context: ExtensionCommandContext,
): Promise<void> {
	const prUrl = dependencies.sessionState.moduleState.pr.prUrl;
	const hasPrUrl = prUrl !== undefined && prUrl.trim() !== "";
	if (!hasPrUrl) {
		notify(context, REVIEW_NO_PR);
		return;
	}
	const worktreePath =
		dependencies.sessionState.gitState.worktreeRoot ?? context.cwd;
	try {
		openReviewPane(dependencies.herdrClient, prUrl, worktreePath);
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		notify(context, `${REVIEW_FAILED}${detail}`);
	}
}

export function register(
	pi: ExtensionAPI,
	dependencies: ReviewCommandDependencies,
): void {
	if (typeof pi.registerCommand !== "function") return;
	pi.registerCommand(REVIEW_COMMAND, {
		description: REVIEW_DESCRIPTION,
		handler: (_args: string, context: ExtensionCommandContext) =>
			runReview(dependencies, context),
	});
}
