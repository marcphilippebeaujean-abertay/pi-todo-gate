const GH_COMMAND = "gh";
const PR_COMMAND = "pr";
const JSON_FLAG = "--json";
const UNKNOWN_STATE = "UNKNOWN";
const MERGED_STATE = "MERGED";
const OPEN_STATE = "OPEN";
const CLOSED_STATE = "CLOSED";
const OBJECT_TYPE = "object";

type MergedPrData = { state?: unknown; mergedAt?: unknown };

function isString(value: unknown): value is string {
	return typeof value === "string";
}

function isMergedPrData(
	data: MergedPrData,
): data is { state: "MERGED"; mergedAt: string } {
	const hasMergedState = data.state === MERGED_STATE;
	if (typeof data.mergedAt !== "string") return false;
	const hasMergedAt = data.mergedAt.trim() !== "";
	return hasMergedState && hasMergedAt;
}

function stateFromMergedData(data: MergedPrData): OpenPrInfo["state"] {
	const isMerged = isMergedPrData(data);
	if (isMerged) return MERGED_STATE;
	const isOpenOrClosed =
		data.state === OPEN_STATE || data.state === CLOSED_STATE;
	if (isOpenOrClosed) return data.state as OpenPrInfo["state"];
	return UNKNOWN_STATE;
}

import type { CommandResult, Exec } from "../shared/command.ts";
import { githubPrUrl } from "./detection.ts";

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
		const row: unknown = JSON.parse(result.stdout);
		if (typeof row !== OBJECT_TYPE) return UNKNOWN_STATE;
		if (row === null) return UNKNOWN_STATE;
		const data = row as MergedPrData;
		return stateFromMergedData(data);
	} catch {
		return UNKNOWN_STATE;
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
		const rows: unknown = JSON.parse(stdout);
		if (!Array.isArray(rows)) return { url: null, state: UNKNOWN_STATE };
		const hasNoRows = rows.length === 0;
		if (hasNoRows) return { url: null, state: OPEN_STATE };
		const firstRow = rows[0];
		if (typeof firstRow !== OBJECT_TYPE)
			return { url: null, state: UNKNOWN_STATE };
		if (firstRow === null) return { url: null, state: UNKNOWN_STATE };
		const row = firstRow as { url?: unknown; state?: unknown };
		const hasUrl = isString(row.url);
		const url = hasUrl ? githubPrUrl(row.url as string) : null;
		const isOpen = row.state === OPEN_STATE;
		const isClosed = row.state === CLOSED_STATE;
		const isMerged = row.state === MERGED_STATE;
		const state = isOpen
			? OPEN_STATE
			: isClosed
				? CLOSED_STATE
				: isMerged
					? MERGED_STATE
					: UNKNOWN_STATE;
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

export {
	detectMerge,
	matchesPinnedPr,
	mergeCommand,
} from "../shared/merge-detection.ts";
