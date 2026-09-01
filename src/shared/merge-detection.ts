const STRING_LITERAL_GIT_9B1A99C5 = "git";
const STRING_LITERAL_GH_24B57162 = "gh";
const STRING_LITERAL_EMPTY_9BE26789 = "--";
const STRING_LITERAL_AUTO_4D4984CD = "--auto=";
const STRING_LITERAL_GITHUB_COM_7A4F50A3 = "github.com";
const STRING_LITERAL_PR_BE5834CA = "pr";
const STRING_LITERAL_VIEW_C69C8EE7 = "view";
const STRING_LITERAL_JSON_C54094BE = "--json";
const STRING_LITERAL_HEADREFNAME_582A7721 = "headRefName";
const STRING_LITERAL_URL_HEADREFNAME_E699868E = "url,headRefName";
const STRING_LITERAL_MERGE_2E9F4B61 = "merge";

import { executableName, shellSegments, shellWords } from "../shell-parser.ts";
import type { CommandResult, Exec } from "./command.ts";
import { matchesPinnedPr } from "./merge-matching.ts";

export interface MergeEvent {
	prUrl: string;
}

function parseMergeWords(
	words: string[],
): { kind: "git" | "gh"; args: string[] } | null {
	const hasTooFewWords = words.length < 2;
	if (hasTooFewWords) return null;
	const executable = executableName(words[0] ?? "");
	const isGit = executable === STRING_LITERAL_GIT_9B1A99C5;
	const isGitMerge = isGit && words[1] === STRING_LITERAL_MERGE_2E9F4B61;
	if (isGitMerge)
		return { kind: STRING_LITERAL_GIT_9B1A99C5, args: words.slice(2) };
	const hasTooFewGhWords = words.length < 3;
	if (hasTooFewGhWords) return null;
	const isGh = executable === STRING_LITERAL_GH_24B57162;
	const hasPrCommand = words[1] === STRING_LITERAL_PR_BE5834CA;
	const hasMergeCommand = words[2] === STRING_LITERAL_MERGE_2E9F4B61;
	if (!isGh) return null;
	if (!hasPrCommand) return null;
	if (!hasMergeCommand) return null;
	return { kind: STRING_LITERAL_GH_24B57162, args: words.slice(3) };
}

export function mergeCommand(
	command: string,
): { kind: "git" | "gh"; args: string[] } | null {
	const segments = shellSegments(command);
	const hasSingleSegment = segments.length === 1;
	if (!hasSingleSegment) return null;
	const words = shellWords(segments[0] ?? "");
	return parseMergeWords(words);
}

const GIT_MERGE_VALUE_OPTIONS = new Set([
	"-m",
	"--message",
	"-s",
	"--strategy",
	"-X",
	"--strategy-option",
	"--into-name",
]);
const NON_COMPLETING_GIT_MERGE_OPTIONS = new Set(["--no-commit", "--squash"]);
const NON_COMPLETING_GH_MERGE_OPTIONS = new Set(["--auto", "--dry-run"]);

export function hasNonCompletingMergeOption(
	kind: "git" | "gh",
	args: readonly string[],
): boolean {
	const options =
		kind === STRING_LITERAL_GIT_9B1A99C5
			? NON_COMPLETING_GIT_MERGE_OPTIONS
			: NON_COMPLETING_GH_MERGE_OPTIONS;
	for (const arg of args) {
		const isEndOfOptions = arg === STRING_LITERAL_EMPTY_9BE26789;
		if (isEndOfOptions) break;
		const isGhKind = kind === STRING_LITERAL_GH_24B57162;
		const hasAutoPrefix =
			isGhKind && arg.startsWith(STRING_LITERAL_AUTO_4D4984CD);
		const isNonCompletingOption = options.has(arg) || hasAutoPrefix;
		if (isNonCompletingOption) return true;
	}
	return false;
}

export function gitMergeTargets(args: string[]): string[] {
	const targets: string[] = [];
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		const isEndOfOptions = arg === STRING_LITERAL_EMPTY_9BE26789;
		if (isEndOfOptions) {
			targets.push(...args.slice(index + 1));
			break;
		}
		const isValueOption = GIT_MERGE_VALUE_OPTIONS.has(arg);
		if (isValueOption) {
			index += 1;
			continue;
		}
		const isInlineValueOption =
			/^(--message=|--strategy=|--strategy-option=|--into-name=|-m)/.test(arg);
		if (isInlineValueOption) continue;
		const isPositionalArgument = !arg.startsWith("-");
		if (isPositionalArgument) targets.push(arg);
	}
	return targets;
}

const GH_MERGE_FLAG_OPTIONS = new Set([
	"--admin",
	"--auto",
	"--delete-branch",
	"--disable-auto",
	"--dry-run",
	"--merge",
	"--rebase",
	"--squash",
]);
const GH_MERGE_VALUE_OPTIONS = new Set([
	"--author-email",
	"--body",
	"--body-file",
	"--match-head-commit",
	"--subject",
	"--repo",
	"-R",
]);

export function ghMergeTargets(args: string[]): string[] | null {
	const targets: string[] = [];
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		const isEndOfOptions = arg === STRING_LITERAL_EMPTY_9BE26789;
		if (isEndOfOptions) {
			targets.push(...args.slice(index + 1));
			break;
		}
		const isRepoOption = /^(--repo|-R|--repo=)/.test(arg);
		if (isRepoOption) return null;
		const isValueOption = GH_MERGE_VALUE_OPTIONS.has(arg);
		if (isValueOption) {
			index += 1;
			continue;
		}
		const isFlag = arg.startsWith("-");
		if (isFlag) {
			const isKnownFlag = GH_MERGE_FLAG_OPTIONS.has(arg);
			if (isKnownFlag) continue;
			const hasFollowingValue =
				index + 1 < args.length && !args[index + 1].startsWith("-");
			if (hasFollowingValue) return null;
			continue;
		}
		targets.push(arg);
	}
	return targets;
}

export function normalizedUrl(value: string): string | null {
	const candidate = value.match(/https?:\/\/github\.com\/[^\s<>"']+/i)?.[0];
	const hasNoCandidate = candidate === undefined;
	if (hasNoCandidate) return null;
	try {
		const url = new URL(candidate.replace(/[.,;:!?)}\]]+$/g, ""));
		const hasGithubHostname =
			url.hostname.toLowerCase() === STRING_LITERAL_GITHUB_COM_7A4F50A3;
		if (!hasGithubHostname) return null;
		const match = url.pathname.match(
			/^\/([^/]+)\/([^/]+)\/pull\/([1-9]\d*)\/?$/,
		);
		return match
			? `https://github.com/${match[1]}/${match[2]}/pull/${match[3]}`
			: null;
	} catch {
		return null;
	}
}

export async function queryPinnedHead(
	exec: Exec,
	cwd: string,
	prUrl: string,
): Promise<string | null> {
	let result: CommandResult;
	try {
		result = await exec(
			STRING_LITERAL_GH_24B57162,
			[
				STRING_LITERAL_PR_BE5834CA,
				STRING_LITERAL_VIEW_C69C8EE7,
				prUrl,
				STRING_LITERAL_JSON_C54094BE,
				STRING_LITERAL_HEADREFNAME_582A7721,
			],
			{
				cwd,
			},
		);
	} catch {
		return null;
	}
	const commandFailed = result.code !== 0;
	if (commandFailed) return null;
	try {
		const data: unknown = JSON.parse(result.stdout);
		if (typeof data !== "object") return null;
		if (data === null) return null;
		const headRefName = (data as { headRefName?: unknown }).headRefName;
		if (typeof headRefName !== "string") return null;
		return headRefName;
	} catch {
		return null;
	}
}

export async function queryCurrentPr(
	exec: Exec,
	cwd: string,
	target: string,
): Promise<{ url: string; headRefName: string } | null> {
	let result: CommandResult;
	try {
		result = await exec(
			STRING_LITERAL_GH_24B57162,
			[
				STRING_LITERAL_PR_BE5834CA,
				STRING_LITERAL_VIEW_C69C8EE7,
				target,
				STRING_LITERAL_JSON_C54094BE,
				STRING_LITERAL_URL_HEADREFNAME_E699868E,
			],
			{ cwd },
		);
	} catch {
		return null;
	}
	const commandFailed = result.code !== 0;
	if (commandFailed) return null;
	try {
		const data: unknown = JSON.parse(result.stdout);
		if (typeof data !== "object") return null;
		if (data === null) return null;
		const row = data as { url?: unknown; headRefName?: unknown };
		const hasUrl = typeof row.url === "string";
		if (!hasUrl) return null;
		const hasHeadRefName = typeof row.headRefName === "string";
		if (!hasHeadRefName) return null;
		return {
			url: row.url as string,
			headRefName: row.headRefName as string,
		};
	} catch {
		return null;
	}
}

export { matchesPinnedPr } from "./merge-matching.ts";

export async function detectMerge(
	exec: Exec,
	cwd: string,
	command: string,
	prUrl: string,
): Promise<MergeEvent | null> {
	return (await matchesPinnedPr(exec, cwd, command, prUrl))
		? { prUrl: normalizedUrl(prUrl) ?? prUrl }
		: null;
}
