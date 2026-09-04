const GIT_COMMAND = "git";
const GH_COMMAND = "gh";
const END_OF_OPTIONS = "--";
const AUTO_FLAG_PREFIX = "--auto=";
const GITHUB_HOST = "github.com";
const PR_COMMAND = "pr";
const VIEW_COMMAND = "view";
const JSON_FLAG = "--json";
const HEAD_REF_NAME_FIELD = "headRefName";
const URL_HEAD_REF_NAME_FIELDS = "url,headRefName";
const MERGE_COMMAND = "merge";

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
	const isGit = executable === GIT_COMMAND;
	const isGitMerge = isGit && words[1] === MERGE_COMMAND;
	if (isGitMerge) return { kind: GIT_COMMAND, args: words.slice(2) };
	const hasTooFewGhWords = words.length < 3;
	if (hasTooFewGhWords) return null;
	const isGh = executable === GH_COMMAND;
	const hasPrCommand = words[1] === PR_COMMAND;
	const hasMergeCommand = words[2] === MERGE_COMMAND;
	if (!isGh) return null;
	if (!hasPrCommand) return null;
	if (!hasMergeCommand) return null;
	return { kind: GH_COMMAND, args: words.slice(3) };
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
	const isGitKind = kind === GIT_COMMAND;
	const options = isGitKind
		? NON_COMPLETING_GIT_MERGE_OPTIONS
		: NON_COMPLETING_GH_MERGE_OPTIONS;
	for (const arg of args) {
		const isEndOfOptions = arg === END_OF_OPTIONS;
		if (isEndOfOptions) break;
		const isGhKind = kind === GH_COMMAND;
		const hasAutoPrefix = isGhKind && arg.startsWith(AUTO_FLAG_PREFIX);
		const isNonCompletingOption = options.has(arg) || hasAutoPrefix;
		if (isNonCompletingOption) return true;
	}
	return false;
}

export function gitMergeTargets(args: string[]): string[] {
	const targets: string[] = [];
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		const isEndOfOptions = arg === END_OF_OPTIONS;
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
		const isEndOfOptions = arg === END_OF_OPTIONS;
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
		const hasGithubHostname = url.hostname.toLowerCase() === GITHUB_HOST;
		if (!hasGithubHostname) return null;
		const match = url.pathname.match(
			/^\/([^/]+)\/([^/]+)\/pull\/([1-9]\d*)\/?$/,
		);
		const hasMatch = match !== null;
		return hasMatch
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
			GH_COMMAND,
			[PR_COMMAND, VIEW_COMMAND, prUrl, JSON_FLAG, HEAD_REF_NAME_FIELD],
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
			GH_COMMAND,
			[PR_COMMAND, VIEW_COMMAND, target, JSON_FLAG, URL_HEAD_REF_NAME_FIELDS],
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
	const isPinnedMatch = await matchesPinnedPr(exec, cwd, command, prUrl);
	return isPinnedMatch ? { prUrl: normalizedUrl(prUrl) ?? prUrl } : null;
}
