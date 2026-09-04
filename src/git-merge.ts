const GIT = "git";
const GH = "gh";
const PR = "pr";
const MERGE = "merge";
const REPO = "--repo";
const SHORT_REPOSITORY_FLAG = "-R";
const REPOSITORY_FLAG_PREFIX = "--repo=";
const DOUBLE_DASH = "--";

import { executableName, shellSegments, shellWords } from "./shell-parser.ts";

function gitMergeCandidate(
	words: string[],
): { kind: "git"; args: string[] } | null {
	const hasEnoughWords = words.length >= 2;
	if (!hasEnoughWords) return null;
	const isGitExecutable = executableName(words[0]) === GIT;
	const isGitMerge = isGitExecutable && words[1] === MERGE;
	if (!isGitMerge) return null;
	return { kind: GIT, args: words.slice(2) };
}

function ghMergeCandidate(
	words: string[],
): { kind: "gh"; args: string[] } | null {
	const hasEnoughWords = words.length >= 3;
	if (!hasEnoughWords) return null;
	const isGhExecutable = executableName(words[0]) === GH;
	const isPullRequestCommand = words[1] === PR;
	const isMergeCommand = words[2] === MERGE;
	const isGhMerge = isGhExecutable && isPullRequestCommand;
	const isCompleteGhMerge = isGhMerge && isMergeCommand;
	if (!isCompleteGhMerge) return null;
	return { kind: GH, args: words.slice(3) };
}

export function mergeCommand(
	command: string,
): { kind: "git" | "gh"; args: string[] } | null {
	const segments = shellSegments(command);
	const hasUnexpectedSegmentCount: boolean = !!(segments.length !== 1);
	if (hasUnexpectedSegmentCount) return null;
	let parsed: { kind: "git" | "gh"; args: string[] } | null = null;
	for (const segment of segments) {
		const words = shellWords(segment);
		const candidate = gitMergeCandidate(words) ?? ghMergeCandidate(words);
		const hasCandidate = candidate !== null;
		if (!hasCandidate) continue;
		const hasParsed = parsed !== null;
		if (hasParsed) return null;
		parsed = candidate;
	}
	return parsed;
}

export function positionalArgs(args: string[]): string[] {
	return args.filter((arg) => {
		const isDoubleDash = arg === DOUBLE_DASH;
		if (isDoubleDash) return false;
		return !arg.startsWith("-");
	});
}

const GH_MERGE_VALUE_OPTIONS = new Set([
	"--author-email",
	"--body",
	"--body-file",
	"--match-head-commit",
	"--subject",
	"--repo",
	SHORT_REPOSITORY_FLAG,
]);

export function ghMergeTargets(args: string[]): string[] | null {
	const targets: string[] = [];
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		const isDoubleDash = arg === DOUBLE_DASH;
		if (isDoubleDash) {
			targets.push(...args.slice(index + 1));
			break;
		}
		const isRepoFlag = arg === REPO || arg === SHORT_REPOSITORY_FLAG;
		const isRepositoryFlag: boolean =
			isRepoFlag || arg.startsWith(REPOSITORY_FLAG_PREFIX);
		if (isRepositoryFlag) return null;
		const isMergeOption: boolean = !!GH_MERGE_VALUE_OPTIONS.has(arg);
		if (isMergeOption) {
			index += 1;
			continue;
		}
		const isLongOption: boolean = !!arg.startsWith("-");
		if (isLongOption) {
			const hasInvalidOptionValue: boolean = !!(
				index + 1 < args.length && !args[index + 1].startsWith("-")
			);
			if (hasInvalidOptionValue) return null;
			continue;
		}
		targets.push(arg);
	}
	return targets;
}
