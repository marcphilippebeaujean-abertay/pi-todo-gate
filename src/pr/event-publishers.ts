import type { CommandResult, Exec } from "../shared/command.ts";
import {
	END_OF_OPTIONS,
	GH_COMMAND,
	GH_KIND,
	GH_MERGE_FLAG_OPTIONS,
	GH_MERGE_VALUE_OPTIONS,
	GIT_COMMAND,
	GIT_MERGE_VALUE_OPTIONS,
	JSON_FLAG,
	MERGE_COMMAND,
	NON_COMPLETING_GH_MERGE_OPTIONS,
	NON_COMPLETING_GIT_MERGE_OPTIONS,
	PR_COMMAND,
	VIEW_COMMAND,
} from "./constants.ts";
import { executableName, shellSegments, shellWords } from "./data.ts";

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
		const hasAutoPrefix = isGhKind && arg.startsWith("--auto=");
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
		const hasGithubHostname = url.hostname.toLowerCase() === "github.com";
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
			[PR_COMMAND, VIEW_COMMAND, prUrl, JSON_FLAG, "headRefName"],
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
			[PR_COMMAND, VIEW_COMMAND, target, JSON_FLAG, "url,headRefName"],
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

export async function detectMerge(
	exec: Exec,
	cwd: string,
	command: string,
	prUrl: string,
): Promise<MergeEvent | null> {
	const isPinnedMatch = await matchesPinnedPr(exec, cwd, command, prUrl);
	return isPinnedMatch ? { prUrl: normalizedUrl(prUrl) ?? prUrl } : null;
}

interface ParsedMerge {
	kind: "git" | "gh";
	args: string[];
}

async function matchesGhMerge(
	exec: Exec,
	cwd: string,
	parsed: ParsedMerge,
	pinned: string,
): Promise<boolean> {
	const targets = ghMergeTargets(parsed.args);
	if (targets === null) return false;
	const hasOneTarget = targets.length === 1;
	if (!hasOneTarget) return false;
	const target = targets[0];
	if (target === undefined) return false;
	const targetMatchesPinned = normalizedUrl(target) === pinned;
	if (targetMatchesPinned) return true;
	const currentPr = await queryCurrentPr(exec, cwd, target);
	if (currentPr === null) return false;
	const currentPrMatchesPinned = normalizedUrl(currentPr.url) === pinned;
	if (!currentPrMatchesPinned) return false;
	return /^\d+$/.test(target) || currentPr.headRefName === target;
}

async function matchesGitMerge(
	exec: Exec,
	cwd: string,
	parsed: ParsedMerge,
	pinned: string,
): Promise<boolean> {
	const targets = gitMergeTargets(parsed.args);
	const hasOneTarget = targets.length === 1;
	if (!hasOneTarget) return false;
	const target = targets[0];
	if (target === undefined) return false;
	const head = await queryPinnedHead(exec, cwd, pinned);
	if (head === null) return false;
	return target === head || target === `refs/heads/${head}`;
}

export async function matchesPinnedPr(
	exec: Exec,
	cwd: string,
	command: string,
	prUrl: string,
): Promise<boolean> {
	const parsed = mergeCommand(command);
	if (parsed === null) return false;
	const pinned = normalizedUrl(prUrl);
	if (pinned === null) return false;
	const isNonCompleting = hasNonCompletingMergeOption(parsed.kind, parsed.args);
	if (isNonCompleting) return false;
	const isGhMerge = parsed.kind === GH_KIND;
	return isGhMerge
		? matchesGhMerge(exec, cwd, parsed, pinned)
		: matchesGitMerge(exec, cwd, parsed, pinned);
}
