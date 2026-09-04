const STRING_LITERAL_GH_9559D5B3 = "gh";
const STRING_LITERAL_PR_6A09DBCA = "pr";
const STRING_LITERAL_VIEW_E4AEC574 = "view";
const STRING_LITERAL_JSON_D1E6AF38 = "--json";
const STRING_LITERAL_STATE_MERGEDAT_C10E3112 = "state,mergedAt";
const STRING_LITERAL_UNKNOWN_02388E71 = "UNKNOWN";
const STRING_LITERAL_MERGED_A75B6D4F = "MERGED";
const STRING_LITERAL_LIST_A2CBC387 = "list";
const STRING_LITERAL_HEAD_942A95FD = "--head";
const STRING_LITERAL_STATE_4D265FF9 = "--state";
const STRING_LITERAL_OPEN_C3334D9B = "open";
const STRING_LITERAL_URL_STATE_ECB484C2 = "url,state";
const STRING_LITERAL_LIMIT_F923B577 = "--limit";
const STRING_LITERAL_OPEN_59CCD2EF = "OPEN";
const STRING_LITERAL_CLOSED_1E0B6F1C = "CLOSED";
const STRING_LITERAL_OBJECT_5F2D4D70 = "object";
const STRING_LITERAL_STRING_9B5A5E11 = "string";

type MergedPrData = { state?: unknown; mergedAt?: unknown };

function isString(value: unknown): value is string {
	return typeof value === STRING_LITERAL_STRING_9B5A5E11;
}

function isMergedPrData(
	data: MergedPrData,
): data is { state: "MERGED"; mergedAt: string } {
	const hasMergedState = data.state === STRING_LITERAL_MERGED_A75B6D4F;
	if (typeof data.mergedAt !== "string") return false;
	const hasMergedAt = data.mergedAt.trim() !== "";
	return hasMergedState && hasMergedAt;
}

function stateFromMergedData(data: MergedPrData): OpenPrInfo["state"] {
	const isMerged = isMergedPrData(data);
	if (isMerged) return STRING_LITERAL_MERGED_A75B6D4F;
	const isOpenOrClosed =
		data.state === STRING_LITERAL_OPEN_59CCD2EF ||
		data.state === STRING_LITERAL_CLOSED_1E0B6F1C;
	if (isOpenOrClosed) return data.state as OpenPrInfo["state"];
	return STRING_LITERAL_UNKNOWN_02388E71;
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
			STRING_LITERAL_GH_9559D5B3,
			[
				STRING_LITERAL_PR_6A09DBCA,
				STRING_LITERAL_VIEW_E4AEC574,
				target,
				STRING_LITERAL_JSON_D1E6AF38,
				fields,
			],
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
	const result = await runGhView(
		exec,
		cwd,
		prUrl,
		STRING_LITERAL_STATE_MERGEDAT_C10E3112,
	);
	if (result === null) return STRING_LITERAL_UNKNOWN_02388E71;
	const commandFailed = result.code !== 0;
	if (commandFailed) return STRING_LITERAL_UNKNOWN_02388E71;
	try {
		const row: unknown = JSON.parse(result.stdout);
		if (typeof row !== STRING_LITERAL_OBJECT_5F2D4D70)
			return STRING_LITERAL_UNKNOWN_02388E71;
		if (row === null) return STRING_LITERAL_UNKNOWN_02388E71;
		const data = row as MergedPrData;
		return stateFromMergedData(data);
	} catch {
		return STRING_LITERAL_UNKNOWN_02388E71;
	}
}

async function runGhList(
	exec: Exec,
	cwd: string,
	branch: string,
): Promise<CommandResult | null> {
	try {
		return await exec(
			STRING_LITERAL_GH_9559D5B3,
			[
				STRING_LITERAL_PR_6A09DBCA,
				STRING_LITERAL_LIST_A2CBC387,
				STRING_LITERAL_HEAD_942A95FD,
				branch,
				STRING_LITERAL_STATE_4D265FF9,
				STRING_LITERAL_OPEN_C3334D9B,
				STRING_LITERAL_JSON_D1E6AF38,
				STRING_LITERAL_URL_STATE_ECB484C2,
				STRING_LITERAL_LIMIT_F923B577,
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
		if (!Array.isArray(rows))
			return { url: null, state: STRING_LITERAL_UNKNOWN_02388E71 };
		const hasNoRows = rows.length === 0;
		if (hasNoRows) return { url: null, state: STRING_LITERAL_OPEN_59CCD2EF };
		const firstRow = rows[0];
		if (typeof firstRow !== STRING_LITERAL_OBJECT_5F2D4D70)
			return { url: null, state: STRING_LITERAL_UNKNOWN_02388E71 };
		if (firstRow === null)
			return { url: null, state: STRING_LITERAL_UNKNOWN_02388E71 };
		const row = firstRow as { url?: unknown; state?: unknown };
		const hasUrl = isString(row.url);
		const url = hasUrl ? githubPrUrl(row.url as string) : null;
		const isOpen = row.state === STRING_LITERAL_OPEN_59CCD2EF;
		const isClosed = row.state === STRING_LITERAL_CLOSED_1E0B6F1C;
		const isMerged = row.state === STRING_LITERAL_MERGED_A75B6D4F;
		const state = isOpen
			? STRING_LITERAL_OPEN_59CCD2EF
			: isClosed
				? STRING_LITERAL_CLOSED_1E0B6F1C
				: isMerged
					? STRING_LITERAL_MERGED_A75B6D4F
					: STRING_LITERAL_UNKNOWN_02388E71;
		return { url, state };
	} catch {
		return { url: null, state: STRING_LITERAL_UNKNOWN_02388E71 };
	}
}

export async function findOpenPr(
	exec: Exec,
	cwd: string,
	branch: string,
): Promise<OpenPrInfo> {
	const result = await runGhList(exec, cwd, branch);
	if (result === null)
		return { url: null, state: STRING_LITERAL_UNKNOWN_02388E71 };
	const commandFailed = result.code !== 0;
	if (commandFailed)
		return { url: null, state: STRING_LITERAL_UNKNOWN_02388E71 };
	return parseOpenPrResult(result.stdout);
}

export {
	detectMerge,
	matchesPinnedPr,
	mergeCommand,
} from "../shared/merge-detection.ts";
