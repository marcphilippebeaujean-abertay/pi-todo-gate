const SIGTERM = "SIGTERM";
const ABORT = "abort";
const DATA = "data";
const ERROR_VALUE = "error";
const CLOSE = "close";
const WORKTREE = "worktree ";
const GIT = "git";
const REV_PARSE = "rev-parse";
const SHOW_TOPLEVEL = "--show-toplevel";
const BRANCH = "branch";
const SHOW_CURRENT = "--show-current";
const WORKTREE_2 = "worktree";
const LIST = "list";
const PORCELAIN = "--porcelain";
const GH = "gh";
const PR = "pr";
const HEAD = "--head";
const STATE = "--state";
const OPEN = "open";
const JSON_2 = "--json";
const URL_STATE = "url,state";
const LIMIT = "--limit";
const UNKNOWN_VALUE = "UNKNOWN";
const OPEN_2 = "OPEN";
const CLOSED = "CLOSED";
const MERGED = "MERGED";
const TEXT_3 = '"';
const MERGE = "merge";
const TEXT_8 = "--";
const REPO = "--repo";
const R = "-R";
const REPO_2 = "--repo=";
const VIEW = "view";
const HEADREFNAME = "headRefName";
const URL_HEADREFNAME = "url,headRefName";

import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { githubPrUrl } from "./pr-detection.ts";

export interface CommandResult {
	stdout: string;
	stderr: string;
	code: number;
	killed?: boolean;
}

export type Exec = (
	command: string,
	args: string[],
	options?: { timeout?: number; signal?: AbortSignal; cwd?: string },
) => Promise<CommandResult>;

export interface WorktreeInfo {
	isWorktree: boolean;
	root: string | null;
	branch: string | null;
}

export interface OpenPrInfo {
	url: string | null;
	state: "OPEN" | "CLOSED" | "MERGED" | "UNKNOWN";
}

export const spawnExec: Exec = (command, args, options = {}) =>
	new Promise((resolveResult) => {
		const child = spawn(command, args, { cwd: options.cwd, shell: false });
		let stdout = "";
		let stderr = "";
		let killed = false;
		let settled = false;
		const finish = (result: CommandResult) => {
			if (settled) return;
			settled = true;
			resolveResult(result);
		};
		const timer = options.timeout
			? setTimeout(() => {
					killed = true;
					child.kill(SIGTERM);
				}, options.timeout)
			: undefined;
		const onAbort = () => {
			killed = true;
			child.kill(SIGTERM);
		};
		options.signal?.addEventListener(ABORT, onAbort, {
			once: true,
		});
		child.stdout.on(DATA, (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		child.stderr.on(DATA, (chunk: Buffer) => {
			stderr += chunk.toString();
		});
		child.on(ERROR_VALUE, (error) => {
			if (timer) clearTimeout(timer);
			options.signal?.removeEventListener(ABORT, onAbort);
			finish({ stdout, stderr: `${stderr}${error.message}`, code: 1, killed });
		});
		child.on(CLOSE, (code) => {
			if (timer) clearTimeout(timer);
			options.signal?.removeEventListener(ABORT, onAbort);
			finish({ stdout, stderr, code: code ?? 1, killed });
		});
	});

function firstWorktreePath(output: string): string | null {
	const line = output
		.split(/\r?\n/)
		.find((value) => value.startsWith(WORKTREE));
	return line ? line.slice(WORKTREE.length).trim() : null;
}

export async function inspectWorktree(
	exec: Exec,
	cwd: string,
): Promise<WorktreeInfo> {
	const [rootResult, branchResult, listResult] = await Promise.all([
		exec(GIT, [REV_PARSE, SHOW_TOPLEVEL], {
			cwd,
		}),
		exec(GIT, [BRANCH, SHOW_CURRENT], {
			cwd,
		}),
		exec(GIT, [WORKTREE_2, LIST, PORCELAIN], { cwd }),
	]);
	const root =
		rootResult.code === 0 && rootResult.stdout.trim()
			? resolve(rootResult.stdout.trim())
			: null;
	const branch =
		branchResult.code === 0 && branchResult.stdout.trim()
			? branchResult.stdout.trim()
			: null;
	const mainRoot =
		listResult.code === 0 ? firstWorktreePath(listResult.stdout) : null;
	let isWorktree = false;
	if (root !== null && mainRoot !== null)
		isWorktree = root !== resolve(mainRoot);
	return { isWorktree, root, branch };
}

export async function findOpenPr(
	exec: Exec,
	cwd: string,
	branch: string,
): Promise<OpenPrInfo> {
	const result = await exec(
		GH,
		[PR, LIST, HEAD, branch, STATE, OPEN, JSON_2, URL_STATE, LIMIT, "1"],
		{ cwd },
	);
	const commandFailed: boolean = !!(result.code !== 0);
	if (commandFailed) return { url: null, state: UNKNOWN_VALUE };
	try {
		const rows: unknown = JSON.parse(result.stdout);
		if (!Array.isArray(rows)) return { url: null, state: UNKNOWN_VALUE };
		const hasNoPullRequests: boolean = !!(rows.length === 0);
		if (hasNoPullRequests) return { url: null, state: OPEN_2 };
		if (typeof rows[0] !== "object" || rows[0] === null) {
			return { url: null, state: UNKNOWN_VALUE };
		}
		const row = rows[0] as { url?: unknown; state?: unknown };
		const url = typeof row.url === "string" ? githubPrUrl(row.url) : null;
		let state: OpenPrInfo["state"] = UNKNOWN_VALUE;
		if (row.state === OPEN_2) state = OPEN_2;
		else if (row.state === CLOSED) state = CLOSED;
		else if (row.state === MERGED) state = MERGED;
		return { url, state };
	} catch {
		return { url: null, state: UNKNOWN_VALUE };
	}
}

function shellSegments(command: string): string[] {
	const segments: string[] = [];
	let current = "";
	let quote: "'" | '"' | null = null;
	let escaped = false;
	for (const character of command) {
		if (escaped) {
			current += character;
			escaped = false;
			continue;
		}
		if (character === "\\" && quote !== "'") {
			current += character;
			escaped = true;
			continue;
		}
		const isInsideQuote: boolean = !!quote;
		if (isInsideQuote) {
			current += character;
			if (character === quote) quote = null;
			continue;
		}
		if (character === "'" || character === TEXT_3) {
			quote = character;
			current += character;
			continue;
		}
		const isBasicWhitespace = character === ";" || character === "|";
		const isWhitespace: boolean = isBasicWhitespace || character === "&";
		if (isWhitespace) {
			const hasCurrentToken: boolean = !!current.trim();
			if (hasCurrentToken) segments.push(current.trim());
			current = "";
			continue;
		}
		current += character;
	}
	const hasCurrentSegment: boolean = !!current.trim();
	if (hasCurrentSegment) segments.push(current.trim());
	return segments;
}

function shellWords(segment: string): string[] {
	const words: string[] = [];
	let current = "";
	let quote: "'" | '"' | null = null;
	let escaped = false;
	const push = () => {
		const shouldPushWord: boolean = !!(current || words.length === 0);
		if (shouldPushWord) words.push(current);
		current = "";
	};
	for (const character of segment) {
		if (escaped) {
			current += character;
			escaped = false;
			continue;
		}
		if (character === "\\" && quote !== "'") {
			escaped = true;
			continue;
		}
		const isInsideQuote: boolean = !!quote;
		if (isInsideQuote) {
			if (character === quote) quote = null;
			else current += character;
			continue;
		}
		if (character === "'" || character === TEXT_3) {
			quote = character;
			continue;
		}
		const isWhitespace: boolean = !!/\s/.test(character);
		if (isWhitespace) {
			const hasCurrentWord: boolean = !!current;
			if (hasCurrentWord) push();
			continue;
		}
		current += character;
	}
	if (escaped) current += "\\";
	const hasCurrentWord: boolean = !!current;
	if (hasCurrentWord) push();
	return words;
}

function executableName(value: string): string {
	return value.split("/").at(-1) ?? value;
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
		let candidate: { kind: "git" | "gh"; args: string[] } | null = null;
		const hasGitMergeWords = words.length >= 2;
		if (hasGitMergeWords) {
			const isGitExecutable = executableName(words[0]) === GIT;
			if (isGitExecutable && words[1] === MERGE)
				candidate = { kind: GIT, args: words.slice(2) };
		}
		const hasGhMergeWords = words.length >= 3;
		if (hasGhMergeWords) {
			const isGhExecutable = executableName(words[0]) === GH;
			if (isGhExecutable && words[1] === PR) {
				if (words[2] === MERGE) candidate = { kind: GH, args: words.slice(3) };
			}
		}
		if (!candidate) continue;
		if (parsed) return null;
		parsed = candidate;
	}
	return parsed;
}

function positionalArgs(args: string[]): string[] {
	return args.filter((arg) => {
		if (arg === TEXT_8) return false;
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
	"-R",
]);

function ghMergeTargets(args: string[]): string[] | null {
	const targets: string[] = [];
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === TEXT_8) {
			targets.push(...args.slice(index + 1));
			break;
		}
		const isRepoFlag = arg === REPO || arg === R;
		const isRepositoryFlag: boolean = isRepoFlag || arg.startsWith(REPO_2);
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

function normalizedUrl(value: string): string | null {
	return githubPrUrl(value);
}

async function queryPinnedHead(
	exec: Exec,
	cwd: string,
	prUrl: string,
): Promise<string | null> {
	const result = await exec(GH, [PR, VIEW, prUrl, JSON_2, HEADREFNAME], {
		cwd,
	});
	const commandFailed: boolean = !!(result.code !== 0);
	if (commandFailed) return null;
	try {
		const data: unknown = JSON.parse(result.stdout);
		if (typeof data !== "object" || data === null) return null;
		const headRefName = (data as { headRefName?: unknown }).headRefName;
		return typeof headRefName === "string" ? headRefName : null;
	} catch {
		return null;
	}
}

async function queryCurrentPr(
	exec: Exec,
	cwd: string,
	target: string,
): Promise<{ url: string; headRefName: string } | null> {
	const result = await exec(GH, [PR, VIEW, target, JSON_2, URL_HEADREFNAME], {
		cwd,
	});
	const commandFailed: boolean = !!(result.code !== 0);
	if (commandFailed) return null;
	try {
		const data: unknown = JSON.parse(result.stdout);
		if (typeof data !== "object" || data === null) return null;
		const row = data as { url?: unknown; headRefName?: unknown };
		if (typeof row.url !== "string" || typeof row.headRefName !== "string")
			return null;
		return { url: row.url, headRefName: row.headRefName };
	} catch {
		return null;
	}
}

export async function matchesPinnedPr(
	exec: Exec,
	cwd: string,
	command: string,
	prUrl: string,
): Promise<boolean> {
	const parsed = mergeCommand(command);
	const pinned = normalizedUrl(prUrl);
	if (parsed === null || pinned === null) return false;

	if (parsed.kind === GH) {
		const targets = ghMergeTargets(parsed.args);
		if (targets === null) return false;
		const hasSingleTarget = targets.length === 1;
		if (!hasSingleTarget) return false;
		const target = targets[0];
		const targetUrl = normalizedUrl(target);
		const matchesPinnedUrl = targetUrl === pinned;
		if (matchesPinnedUrl) return true;
		const currentPr = await queryCurrentPr(exec, cwd, target);
		if (currentPr === null) return false;
		const isCurrentPrPinned = normalizedUrl(currentPr.url) === pinned;
		if (!isCurrentPrPinned) return false;
		return /^\d+$/.test(target) || currentPr.headRefName === target;
	}

	const targets = positionalArgs(parsed.args);
	if (targets === null) return false;
	const hasSingleTarget = targets.length === 1;
	if (!hasSingleTarget) return false;
	const head = await queryPinnedHead(exec, cwd, pinned);
	if (head === null) return false;
	return targets[0] === head || targets[0] === `refs/heads/${head}`;
}
