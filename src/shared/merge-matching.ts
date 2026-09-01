const GH_KIND = "gh";

import type { Exec } from "./command.ts";
import {
	ghMergeTargets,
	gitMergeTargets,
	hasNonCompletingMergeOption,
	mergeCommand,
	normalizedUrl,
	queryCurrentPr,
	queryPinnedHead,
} from "./merge-detection.ts";

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
