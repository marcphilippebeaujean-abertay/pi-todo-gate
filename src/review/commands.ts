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
	PANE,
	PANE_FLAG,
	PROMPT,
	REVIEW_AGENT_KIND,
	REVIEW_AGENT_NAME,
	REVIEW_AGENT_NO_EXTENSIONS,
	REVIEW_COMMAND,
	REVIEW_DESCRIPTION,
	REVIEW_FAILED,
	REVIEW_NO_PANE,
	REVIEW_NO_PR,
	REVIEW_PANE_DIRECTION,
	REVIEW_PROMPT_MIDDLE,
	REVIEW_PROMPT_PREFIX,
	REVIEW_PROMPT_SUFFIX,
	SPLIT,
	START,
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
	herdrClient(HERDR_COMMAND, [
		AGENT,
		START,
		REVIEW_AGENT_NAME,
		KIND_FLAG,
		REVIEW_AGENT_KIND,
		PANE_FLAG,
		paneId,
		ARGUMENT_SEPARATOR,
		REVIEW_AGENT_NO_EXTENSIONS,
	]);
	herdrClient(HERDR_COMMAND, [
		AGENT,
		PROMPT,
		REVIEW_AGENT_NAME,
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
