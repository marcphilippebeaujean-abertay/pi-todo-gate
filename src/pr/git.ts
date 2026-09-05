const GH_COMMAND = "gh";
const PR_COMMAND = "pr";
const JSON_FLAG = "--json";
const UNKNOWN_STATE = "UNKNOWN";
const MERGED_STATE = "MERGED";
const OPEN_STATE = "OPEN";
const CLOSED_STATE = "CLOSED";

function stateFromMergedData(data: unknown): OpenPrInfo["state"] {
	const parsed = mergedPrDataSchema.safeParse(data);
	const isInvalidData = !parsed.success;
	if (isInvalidData) return UNKNOWN_STATE;
	const row = parsed.data;
	const hasMergedState = row.state === MERGED_STATE;
	const hasMergedAt = row.mergedAt !== undefined && row.mergedAt.trim() !== "";
	const isMergedData = hasMergedState && hasMergedAt;
	if (isMergedData) return MERGED_STATE;
	const isOpenState = row.state === OPEN_STATE;
	if (isOpenState) return OPEN_STATE;
	const isClosedState = row.state === CLOSED_STATE;
	if (isClosedState) return CLOSED_STATE;
	return UNKNOWN_STATE;
}

import type { CommandResult, Exec } from "../shared/command.ts";
import { githubPrUrl } from "./detection.ts";
import { mergedPrDataSchema, openPrRowsSchema } from "./schemas.ts";

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
