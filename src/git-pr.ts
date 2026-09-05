import type { Exec, OpenPrInfo } from "./git.ts";
import { ghMergeTargets, mergeCommand, positionalArgs } from "./git-merge.ts";
import {
	currentPrSchema,
	headRefSchema,
	openPrRowsSchema,
} from "./pr/schemas.ts";
import { githubPrUrl } from "./pr-detection.ts";

const GH = "gh";
const PR = "pr";
const LIST = "list";
const HEAD = "--head";
const STATE = "--state";
const OPEN = "open";
const JSON_OUTPUT_FLAG = "--json";
const URL_STATE = "url,state";
const LIMIT = "--limit";
const UNKNOWN_VALUE = "UNKNOWN";
const OPEN_PR_STATE = "OPEN";
const CLOSED = "CLOSED";
const MERGED = "MERGED";
const VIEW = "view";
const HEADREFNAME = "headRefName";
const URL_HEADREFNAME = "url,headRefName";

function unknownOpenPr(): OpenPrInfo {
	return { url: null, state: UNKNOWN_VALUE };
}

function parseOpenPrRows(rows: unknown): OpenPrInfo {
	const parsed = openPrRowsSchema.safeParse(rows);
	const isInvalidRows = !parsed.success;
	if (isInvalidRows) return unknownOpenPr();
	const hasNoPullRequests = parsed.data.length === 0;
	if (hasNoPullRequests) return { url: null, state: OPEN_PR_STATE };
	const row = parsed.data[0];
	const hasNoRow = row === undefined;
	if (hasNoRow) return unknownOpenPr();
	const url = row.url === undefined ? null : githubPrUrl(row.url);
	let state: OpenPrInfo["state"] = UNKNOWN_VALUE;
	const isOpenState = row.state === OPEN_PR_STATE;
	if (isOpenState) state = OPEN_PR_STATE;
	const isClosedState = row.state === CLOSED;
	if (isClosedState) state = CLOSED;
	const isMergedState = row.state === MERGED;
	if (isMergedState) state = MERGED;
	return { url, state };
}

function parseOpenPrOutput(output: string): OpenPrInfo {
	try {
		return parseOpenPrRows(JSON.parse(output));
	} catch {
		return unknownOpenPr();
	}
}

export async function findOpenPr(
	exec: Exec,
	cwd: string,
	branch: string,
): Promise<OpenPrInfo> {
	const result = await exec(
		GH,
		[
			PR,
			LIST,
			HEAD,
			branch,
			STATE,
			OPEN,
			JSON_OUTPUT_FLAG,
			URL_STATE,
			LIMIT,
			"1",
		],
		{ cwd },
	);
	const commandFailed = result.code !== 0;
	if (commandFailed) return unknownOpenPr();
	return parseOpenPrOutput(result.stdout);
}

async function queryPinnedHead(
	exec: Exec,
	cwd: string,
	prUrl: string,
): Promise<string | null> {
	const result = await exec(
		GH,
		[PR, VIEW, prUrl, JSON_OUTPUT_FLAG, HEADREFNAME],
		{
			cwd,
		},
	);
	const commandFailed: boolean = !!(result.code !== 0);
	if (commandFailed) return null;
	try {
		const parsed = headRefSchema.safeParse(JSON.parse(result.stdout));
		const hasValidHeadRef = parsed.success;
		if (!hasValidHeadRef) return null;
		return parsed.data.headRefName;
	} catch {
		return null;
	}
}

async function queryCurrentPr(
	exec: Exec,
	cwd: string,
	target: string,
): Promise<{ url: string; headRefName: string } | null> {
	const result = await exec(
		GH,
		[PR, VIEW, target, JSON_OUTPUT_FLAG, URL_HEADREFNAME],
		{
			cwd,
		},
	);
	const commandFailed: boolean = !!(result.code !== 0);
	if (commandFailed) return null;
	try {
		const parsed = currentPrSchema.safeParse(JSON.parse(result.stdout));
		const isInvalidCurrentPr = !parsed.success;
		if (isInvalidCurrentPr) return null;
		return parsed.data;
	} catch {
		return null;
	}
}

async function matchesGhMerge(
	exec: Exec,
	cwd: string,
	parsed: { args: string[] },
	pinned: string,
): Promise<boolean> {
	const targets = ghMergeTargets(parsed.args);
	const hasTargets = targets !== null;
	if (!hasTargets) return false;
	const hasSingleTarget = targets.length === 1;
	if (!hasSingleTarget) return false;
	const target = targets[0];
	const targetUrl = githubPrUrl(target);
	const matchesPinnedUrl = targetUrl === pinned;
	if (matchesPinnedUrl) return true;
	const currentPr = await queryCurrentPr(exec, cwd, target);
	if (currentPr === null) return false;
	const isCurrentPrPinned = githubPrUrl(currentPr.url) === pinned;
	if (!isCurrentPrPinned) return false;
	return /^\d+$/.test(target) || currentPr.headRefName === target;
}

async function matchesGitMerge(
	exec: Exec,
	cwd: string,
	parsed: { args: string[] },
	pinned: string,
): Promise<boolean> {
	const targets = positionalArgs(parsed.args);
	const hasTargets = targets !== null;
	if (!hasTargets) return false;
	const hasSingleTarget = targets.length === 1;
	if (!hasSingleTarget) return false;
	const head = await queryPinnedHead(exec, cwd, pinned);
	if (head === null) return false;
	return targets[0] === head || targets[0] === `refs/heads/${head}`;
}

export async function matchesPinnedPr(
	exec: Exec,
	cwd: string,
	command: string,
	prUrl: string,
): Promise<boolean> {
	const parsed = mergeCommand(command);
	const pinned = githubPrUrl(prUrl);
	const hasParsed = parsed !== null;
	if (!hasParsed) return false;
	const hasPinned = pinned !== null;
	if (!hasPinned) return false;
	const isGhCommand = parsed.kind === GH;
	if (isGhCommand) return matchesGhMerge(exec, cwd, parsed, pinned);
	return matchesGitMerge(exec, cwd, parsed, pinned);
}
