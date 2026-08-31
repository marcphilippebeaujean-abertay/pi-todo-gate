import { execFileSync } from "node:child_process";
import { isLinkedWorktreePaths, parseBranchName } from "./git.ts";
import type { CommandRunner } from "./herdr-claim-gate.ts";

export function isSubagent(): boolean {
	return process.env.PI_SUBAGENT_CHILD === "1";
}

export function isInsideHerdr(): boolean {
	return process.env.HERDR_ENV === "1";
}

export function runCommand(
	command: string,
	args: string[],
	cwd: string,
): string {
	return execFileSync(command, args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
	});
}

function jsonResult<T>(output: string): T | undefined {
	try {
		return JSON.parse(output) as T;
	} catch {
		return undefined;
	}
}

export function tabLabel(commandRunner: CommandRunner): string | undefined {
	const tabId = process.env.HERDR_TAB_ID;
	if (!tabId) return undefined;
	const response = jsonResult<{ result?: { tab?: { label?: string } } }>(
		commandRunner("herdr", ["tab", "get", tabId]),
	);
	const label = response?.result?.tab?.label?.trim();
	return label || undefined;
}

export function isDefaultTabLabel(label: string | undefined): boolean {
	return label !== undefined && /^\d+$/.test(label);
}

export function claimWorktreeTab(
	commandRunner: CommandRunner,
	cwd: string,
): boolean {
	try {
		const gitDir = commandRunner("git", ["rev-parse", "--git-dir"]);
		const commonDir = commandRunner("git", ["rev-parse", "--git-common-dir"]);
		if (!isLinkedWorktreePaths(cwd, gitDir, commonDir)) return false;

		const tabId = process.env.HERDR_TAB_ID;
		const branchName = parseBranchName(
			commandRunner("git", ["branch", "--show-current"]),
		);
		const defaultTabLabel = tabLabel(commandRunner);
		if (!tabId || !branchName || !isDefaultTabLabel(defaultTabLabel))
			return false;

		commandRunner("herdr", ["tab", "rename", tabId, branchName]);
		return true;
	} catch {
		return false;
	}
}
