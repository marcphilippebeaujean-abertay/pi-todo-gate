import type { CommandResult, Exec } from "../shared/command.ts";
import { queryCurrentPr, queryPinnedHead } from "./git.ts";

const GIT_COMMAND = "git";
const REV_PARSE_COMMAND = "rev-parse";
const VERIFY_OPTION = "--verify";
const QUIET_OPTION = "--quiet";
const HEAD_REF_PREFIX = "refs/heads/";
const REMOTE_HEAD_REF_PREFIX = "refs/remotes/";

import { GH_KIND } from "./constants.ts";
import type { MergeEvent } from "./events.ts";
import {
	ghMergeTargets,
	gitMergeTargets,
	hasNonCompletingMergeOption,
	mergeCommand,
	normalizedUrl,
} from "./parsing.ts";
import type { ParsedMerge } from "./state.ts";

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

async function gitRefExists(
	exec: Exec,
	cwd: string,
	ref: string,
): Promise<boolean> {
	let result: CommandResult;
	try {
		result = await exec(
			GIT_COMMAND,
			[REV_PARSE_COMMAND, VERIFY_OPTION, QUIET_OPTION, ref],
			{ cwd },
		);
	} catch {
		return false;
	}
	return result.code === 0;
}

async function matchesGitHead(
	exec: Exec,
	cwd: string,
	target: string,
	head: string,
): Promise<boolean> {
	const isDirectHead =
		target === head || target === `${HEAD_REF_PREFIX}${head}`;
	if (isDirectHead) return true;
	const hasFullRemoteRef = target.startsWith(REMOTE_HEAD_REF_PREFIX);
	const remoteTarget = hasFullRemoteRef
		? target.slice(REMOTE_HEAD_REF_PREFIX.length)
		: target;
	const separator = remoteTarget.indexOf("/");
	const hasRemote = separator > 0;
	if (!hasRemote) return false;
	const remoteHead = remoteTarget.slice(separator + 1);
	const hasMatchingRemoteHead = remoteHead === head;
	if (!hasMatchingRemoteHead) return false;
	if (hasFullRemoteRef) return true;
	const localRef = `${HEAD_REF_PREFIX}${target}`;
	const remoteRef = `${REMOTE_HEAD_REF_PREFIX}${target}`;
	const [hasLocalRef, hasRemoteRef] = await Promise.all([
		gitRefExists(exec, cwd, localRef),
		gitRefExists(exec, cwd, remoteRef),
	]);
	return !hasLocalRef && hasRemoteRef;
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
	return matchesGitHead(exec, cwd, target, head);
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

export async function detectMerge(
	exec: Exec,
	cwd: string,
	command: string,
	prUrl: string,
): Promise<MergeEvent | null> {
	const isPinnedMatch = await matchesPinnedPr(exec, cwd, command, prUrl);
	return isPinnedMatch ? { prUrl: normalizedUrl(prUrl) ?? prUrl } : null;
}
