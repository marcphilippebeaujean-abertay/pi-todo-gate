import type { CommandResult, Exec } from "../shared/command.ts";
import {
	GH_COMMAND,
	JSON_FLAG,
	MERGE_PR_MODE,
	MERGE_COMMAND as MERGE_PROTOCOL_COMMAND,
	PR_COMMAND,
	UNKNOWN_STATE,
	VIEW_COMMAND,
} from "./constants.ts";
import {
	githubPrUrl,
	openPrRowSchema,
	parseOpenPrResult,
	stateFromMergedData,
} from "./parsing.ts";
import type { OpenPrInfo } from "./state.ts";

async function runGhView(
	exec: Exec,
	cwd: string,
	target: string,
	fields: string,
): Promise<CommandResult | null> {
	try {
		return await exec(
			GH_COMMAND,
			[PR_COMMAND, VIEW_COMMAND, target, JSON_FLAG, fields],
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
	remoteOrigin: string | null,
): Promise<boolean> {
	const hasRemoteOrigin = remoteOrigin !== null && remoteOrigin.trim() !== "";
	if (!hasRemoteOrigin) return false;
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
		const normalizedUrl = githubPrUrl(url, remoteOrigin);
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

export async function findOpenPr(
	exec: Exec,
	cwd: string,
	branch: string,
	remoteOrigin: string | null,
): Promise<OpenPrInfo> {
	const hasRemoteOrigin = remoteOrigin !== null && remoteOrigin.trim() !== "";
	if (!hasRemoteOrigin) return { url: null, state: UNKNOWN_STATE };
	const result = await runGhList(exec, cwd, branch);
	if (result === null) return { url: null, state: UNKNOWN_STATE };
	const commandFailed = result.code !== 0;
	if (commandFailed) return { url: null, state: UNKNOWN_STATE };
	return parseOpenPrResult(result.stdout, remoteOrigin);
}

export function mergePinnedPr(
	exec: Exec,
	cwd: string,
	prUrl: string,
): Promise<CommandResult> {
	return exec(
		GH_COMMAND,
		[PR_COMMAND, MERGE_PROTOCOL_COMMAND, prUrl, MERGE_PR_MODE],
		{ cwd },
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
