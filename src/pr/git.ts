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

import type { CommandResult, Exec } from "../shared/command.ts";
import { githubPrUrl } from "./detection.ts";

export interface OpenPrInfo {
	url: string | null;
	state: "OPEN" | "CLOSED" | "MERGED" | "UNKNOWN";
}

export async function findPrState(
	exec: Exec,
	cwd: string,
	prUrl: string,
): Promise<OpenPrInfo["state"]> {
	let result: CommandResult;
	try {
		result = await exec(
			STRING_LITERAL_GH_9559D5B3,
			[
				STRING_LITERAL_PR_6A09DBCA,
				STRING_LITERAL_VIEW_E4AEC574,
				prUrl,
				STRING_LITERAL_JSON_D1E6AF38,
				STRING_LITERAL_STATE_MERGEDAT_C10E3112,
			],
			{ cwd },
		);
	} catch {
		return STRING_LITERAL_UNKNOWN_02388E71;
	}
	if (result.code !== 0) return STRING_LITERAL_UNKNOWN_02388E71;
	try {
		const row: unknown = JSON.parse(result.stdout);
		if (typeof row !== "object" || row === null)
			return STRING_LITERAL_UNKNOWN_02388E71;
		const data = row as { state?: unknown; mergedAt?: unknown };
		if (
			data.state === "MERGED" &&
			typeof data.mergedAt === "string" &&
			data.mergedAt.trim() !== ""
		)
			return STRING_LITERAL_MERGED_A75B6D4F;
		if (data.state === "OPEN" || data.state === "CLOSED") return data.state;
		return STRING_LITERAL_UNKNOWN_02388E71;
	} catch {
		return STRING_LITERAL_UNKNOWN_02388E71;
	}
}

export async function findOpenPr(
	exec: Exec,
	cwd: string,
	branch: string,
): Promise<OpenPrInfo> {
	let result: CommandResult;
	try {
		result = await exec(
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
		return { url: null, state: STRING_LITERAL_UNKNOWN_02388E71 };
	}
	if (result.code !== 0)
		return { url: null, state: STRING_LITERAL_UNKNOWN_02388E71 };
	try {
		const rows: unknown = JSON.parse(result.stdout);
		if (!Array.isArray(rows))
			return { url: null, state: STRING_LITERAL_UNKNOWN_02388E71 };
		if (rows.length === 0)
			return { url: null, state: STRING_LITERAL_OPEN_59CCD2EF };
		if (typeof rows[0] !== "object" || rows[0] === null) {
			return { url: null, state: STRING_LITERAL_UNKNOWN_02388E71 };
		}
		const row = rows[0] as { url?: unknown; state?: unknown };
		const url = typeof row.url === "string" ? githubPrUrl(row.url) : null;
		const state =
			row.state === "OPEN" || row.state === "CLOSED" || row.state === "MERGED"
				? row.state
				: STRING_LITERAL_UNKNOWN_02388E71;
		return { url, state };
	} catch {
		return { url: null, state: STRING_LITERAL_UNKNOWN_02388E71 };
	}
}

export {
	detectMerge,
	matchesPinnedPr,
	mergeCommand,
} from "../shared/merge-detection.ts";
