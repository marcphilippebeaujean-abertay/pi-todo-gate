import { fileURLToPath } from "node:url";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { EXTENSION_CONSTANTS as C } from "../constants.ts";
import type { CommandResult, Exec } from "../shared/command.ts";
import { spawnExec } from "../shared/command.ts";
import {
	CLOSED_STATE,
	GH_COMMAND,
	JSON_FLAG,
	MERGE_PR_MODE,
	MERGE_COMMAND as MERGE_PROTOCOL_COMMAND,
	MERGED_STATE,
	OPEN_STATE,
	PR_COMMAND,
	UNKNOWN_STATE,
	VIEW_COMMAND,
} from "./constants.ts";
import {
	githubPrUrl,
	mergedPrDataSchema,
	openPrRowSchema,
	openPrRowsSchema,
} from "./data.ts";
import {
	notifyInactive,
	notifyMergeFailure,
	notifyMergeSucceeded,
	notifyNoPr,
	notifyNoUi,
} from "./notifications.ts";
import { confirmMerge } from "./user-prompts.ts";

function stateFromMergedData(data: unknown): OpenPrInfo["state"] {
	const parsed = mergedPrDataSchema.safeParse(data);
	const isInvalidData = !parsed.success;
	if (isInvalidData) return UNKNOWN_STATE;
	const row = parsed.data;
	const hasMergedAt = row.mergedAt !== undefined && row.mergedAt.trim() !== "";
	switch (row.state) {
		case MERGED_STATE:
			return hasMergedAt ? MERGED_STATE : UNKNOWN_STATE;
		case OPEN_STATE:
			return OPEN_STATE;
		case CLOSED_STATE:
			return CLOSED_STATE;
		default:
			return UNKNOWN_STATE;
	}
}

export interface OpenPrInfo {
	url: string | null;
	state: "OPEN" | "CLOSED" | "MERGED" | "UNKNOWN";
}

async function runGhView(
	exec: Exec,
	cwd: string,
	target: string,
	fields: string,
): Promise<CommandResult | null> {
	try {
		return await exec(
			GH_COMMAND,
			[PR_COMMAND, "view", target, JSON_FLAG, fields],
			{ cwd },
		);
	} catch {
		return null;
	}
}

export async function findPrState(
	exec: Exec,
	cwd: string,
	prUrl: string,
): Promise<OpenPrInfo["state"]> {
	const result = await runGhView(exec, cwd, prUrl, "state,mergedAt");
	if (result === null) return UNKNOWN_STATE;
	const commandFailed = result.code !== 0;
	if (commandFailed) return UNKNOWN_STATE;
	try {
		return stateFromMergedData(JSON.parse(result.stdout));
	} catch {
		return UNKNOWN_STATE;
	}
}

export async function isGithubPrAvailable(
	exec: Exec,
	cwd: string,
	prUrl: string,
): Promise<boolean> {
	const result = await runGhView(exec, cwd, prUrl, "url");
	if (result === null) return false;
	const commandFailed = result.code !== 0;
	if (commandFailed) return false;
	try {
		const parsed = openPrRowSchema.safeParse(JSON.parse(result.stdout));
		const hasInvalidPayload = !parsed.success;
		if (hasInvalidPayload) return false;
		const url = parsed.data.url;
		const hasNoUrl = url === undefined;
		if (hasNoUrl) return false;
		const normalizedUrl = githubPrUrl(url);
		return normalizedUrl === prUrl;
	} catch {
		return false;
	}
}

async function runGhList(
	exec: Exec,
	cwd: string,
	branch: string,
): Promise<CommandResult | null> {
	try {
		return await exec(
			GH_COMMAND,
			[
				PR_COMMAND,
				"list",
				"--head",
				branch,
				"--state",
				"open",
				JSON_FLAG,
				"url,state",
				"--limit",
				"1",
			],
			{ cwd },
		);
	} catch {
		return null;
	}
}

function parseOpenPrResult(stdout: string): OpenPrInfo {
	try {
		const parsed = openPrRowsSchema.safeParse(JSON.parse(stdout));
		const isInvalidRows = !parsed.success;
		if (isInvalidRows) return { url: null, state: UNKNOWN_STATE };
		const hasNoRows = parsed.data.length === 0;
		if (hasNoRows) return { url: null, state: OPEN_STATE };
		const row = parsed.data[0];
		const hasNoRow = row === undefined;
		if (hasNoRow) return { url: null, state: UNKNOWN_STATE };
		const url = row.url === undefined ? null : githubPrUrl(row.url);
		let state: OpenPrInfo["state"];
		switch (row.state) {
			case OPEN_STATE:
				state = OPEN_STATE;
				break;
			case CLOSED_STATE:
				state = CLOSED_STATE;
				break;
			case MERGED_STATE:
				state = MERGED_STATE;
				break;
			default:
				state = UNKNOWN_STATE;
		}
		return { url, state };
	} catch {
		return { url: null, state: UNKNOWN_STATE };
	}
}

export async function findOpenPr(
	exec: Exec,
	cwd: string,
	branch: string,
): Promise<OpenPrInfo> {
	const result = await runGhList(exec, cwd, branch);
	if (result === null) return { url: null, state: UNKNOWN_STATE };
	const commandFailed = result.code !== 0;
	if (commandFailed) return { url: null, state: UNKNOWN_STATE };
	return parseOpenPrResult(result.stdout);
}

export function mergePinnedPr(
	exec: Exec,
	cwd: string,
	prUrl: string,
): Promise<CommandResult> {
	return exec(
		GH_COMMAND,
		[PR_COMMAND, MERGE_PROTOCOL_COMMAND, prUrl, MERGE_PR_MODE],
		{
			cwd,
		},
	);
}

export async function queryPinnedHead(
	exec: Exec,
	cwd: string,
	prUrl: string,
): Promise<string | null> {
	try {
		const result = await exec(
			GH_COMMAND,
			[PR_COMMAND, VIEW_COMMAND, prUrl, JSON_FLAG, "headRefName"],
			{ cwd },
		);
		const commandFailed = result.code !== 0;
		if (commandFailed) return null;
		const data: unknown = JSON.parse(result.stdout);
		const isObject = typeof data === "object";
		const isNull = data === null;
		const isInvalidObject = !isObject || isNull;
		if (isInvalidObject) return null;
		const headRefName = (data as { headRefName?: unknown }).headRefName;
		const hasHeadRefName = typeof headRefName === "string";
		return hasHeadRefName ? headRefName : null;
	} catch {
		return null;
	}
}

export async function queryCurrentPr(
	exec: Exec,
	cwd: string,
	target: string,
): Promise<{ url: string; headRefName: string } | null> {
	try {
		const result = await exec(
			GH_COMMAND,
			[PR_COMMAND, VIEW_COMMAND, target, JSON_FLAG, "url,headRefName"],
			{ cwd },
		);
		const commandFailed = result.code !== 0;
		if (commandFailed) return null;
		const data: unknown = JSON.parse(result.stdout);
		const isObject = typeof data === "object";
		const isNull = data === null;
		const isInvalidObject = !isObject || isNull;
		if (isInvalidObject) return null;
		const row = data as { url?: unknown; headRefName?: unknown };
		const hasUrl = typeof row.url === "string";
		const hasHeadRefName = typeof row.headRefName === "string";
		const hasInvalidFields = !hasUrl || !hasHeadRefName;
		if (hasInvalidFields) return null;
		return {
			url: row.url as string,
			headRefName: row.headRefName as string,
		};
	} catch {
		return null;
	}
}

export const mergeProtocolSkillPath = fileURLToPath(
	new URL("../../skills/merge-protocol", import.meta.url),
);

interface PrSession {
	context: { cwd: string; hasUI: boolean };
	state: { prUrl?: string };
	operationGeneration: number;
	operationQueue?: Promise<void>;
}

export type PrRuntime = {
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
	session.operationQueue = result.then(
		() => undefined,
		() => undefined,
	);
	return result;
}

function failureDetail(stderr: string): string {
	return stderr.replace(/\s+/g, " ").trim().slice(0, 200);
}

async function mergeNow(
	runtime: PrRuntime,
	session: PrSession,
	ctx: ExtensionCommandContext,
	prUrl: string,
	generation: number,
): Promise<boolean> {
	const isCurrent = currentSession(runtime, session, generation);
	if (!isCurrent) return false;
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
		notifyMergeFailure(ctx, failureDetail(result.stderr));
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
	const isCurrent = currentSession(runtime, session, generation);
	if (!isCurrent) return false;
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
	const hasPrUrl = typeof prUrl === "string" && prUrl.trim() !== "";
	if (!hasPrUrl) {
		notifyNoPr(ctx);
		return;
	}
	const generation = session.operationGeneration;
	const enqueue = runtime.enqueueSessionOperation ?? enqueueOperation;
	const merged = await enqueue(
		session,
		confirmAndMerge.bind(null, runtime, session, ctx, prUrl, generation),
	);
	const isMerged = merged;
	const isCurrent = currentSession(runtime, session, generation);
	const shouldStop = !isMerged || !isCurrent;
	if (shouldStop) return;
	await runtime.events.emit(C.event.prMerged, {
		prUrl,
		taskMarkedAsCompleted: false,
	});
	const isCurrentAfterEmit = currentSession(runtime, session, generation);
	if (isCurrentAfterEmit) notifyMergeSucceeded(ctx);
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
