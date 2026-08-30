import { githubPrUrl } from "./pr-detection.ts";
import type { CommandResult, Exec } from "./shared/command.ts";
import { inspectProject, type ProjectInfo } from "./shared/project.ts";

export type { CommandResult, Exec } from "./shared/command.ts";
export { spawnExec } from "./shared/command.ts";

export type WorktreeInfo = ProjectInfo;

export interface OpenPrInfo {
	url: string | null;
	state: "OPEN" | "CLOSED" | "MERGED" | "UNKNOWN";
}

export async function inspectWorktree(
	exec: Exec,
	cwd: string,
): Promise<WorktreeInfo> {
	return inspectProject(exec, cwd);
}

export async function findPrState(
	exec: Exec,
	cwd: string,
	prUrl: string,
): Promise<OpenPrInfo["state"]> {
	let result: CommandResult;
	try {
		result = await exec(
			"gh",
			["pr", "view", prUrl, "--json", "state,mergedAt"],
			{ cwd },
		);
	} catch {
		return "UNKNOWN";
	}
	if (result.code !== 0) return "UNKNOWN";
	try {
		const row: unknown = JSON.parse(result.stdout);
		if (typeof row !== "object" || row === null) return "UNKNOWN";
		const data = row as { state?: unknown; mergedAt?: unknown };
		if (
			data.state === "MERGED" &&
			typeof data.mergedAt === "string" &&
			data.mergedAt.trim() !== ""
		)
			return "MERGED";
		if (data.state === "OPEN" || data.state === "CLOSED") return data.state;
		return "UNKNOWN";
	} catch {
		return "UNKNOWN";
	}
}

export async function findOpenPr(
	exec: Exec,
	cwd: string,
	branch: string,
): Promise<OpenPrInfo> {
	let result: CommandResult;
	try {
		result = await exec(
			"gh",
			[
				"pr",
				"list",
				"--head",
				branch,
				"--state",
				"open",
				"--json",
				"url,state",
				"--limit",
				"1",
			],
			{ cwd },
		);
	} catch {
		return { url: null, state: "UNKNOWN" };
	}
	if (result.code !== 0) return { url: null, state: "UNKNOWN" };
	try {
		const rows: unknown = JSON.parse(result.stdout);
		if (!Array.isArray(rows)) return { url: null, state: "UNKNOWN" };
		if (rows.length === 0) return { url: null, state: "OPEN" };
		if (typeof rows[0] !== "object" || rows[0] === null) {
			return { url: null, state: "UNKNOWN" };
		}
		const row = rows[0] as { url?: unknown; state?: unknown };
		const url = typeof row.url === "string" ? githubPrUrl(row.url) : null;
		const state =
			row.state === "OPEN" || row.state === "CLOSED" || row.state === "MERGED"
				? row.state
				: "UNKNOWN";
		return { url, state };
	} catch {
		return { url: null, state: "UNKNOWN" };
	}
}

function shellSegments(command: string): string[] | null {
	const segments: string[] = [];
	let current = "";
	let quote: "'" | '"' | null = null;
	let escaped = false;
	let terminatedWithOperator = false;
	for (const character of command) {
		if (escaped) {
			current += character;
			escaped = false;
			terminatedWithOperator = false;
			continue;
		}
		if (character === "\\" && quote !== "'") {
			current += character;
			escaped = true;
			terminatedWithOperator = false;
			continue;
		}
		if (quote) {
			current += character;
			if (character === quote) quote = null;
			if (!/\s/.test(character)) terminatedWithOperator = false;
			continue;
		}
		if (character === "'" || character === '"') {
			quote = character;
			current += character;
			terminatedWithOperator = false;
			continue;
		}
		if (character === ";" || character === "|" || character === "&") {
			if (current.trim()) segments.push(current.trim());
			current = "";
			terminatedWithOperator = true;
			continue;
		}
		current += character;
		if (!/\s/.test(character)) terminatedWithOperator = false;
	}
	if (quote || escaped || terminatedWithOperator) return null;
	if (current.trim()) segments.push(current.trim());
	return segments;
}

function shellWords(segment: string): string[] {
	const words: string[] = [];
	let current = "";
	let quote: "'" | '"' | null = null;
	let escaped = false;
	const push = () => {
		if (current || words.length === 0) words.push(current);
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
		if (quote) {
			if (character === quote) quote = null;
			else current += character;
			continue;
		}
		if (character === "'" || character === '"') {
			quote = character;
			continue;
		}
		if (/\s/.test(character)) {
			if (current) push();
			continue;
		}
		current += character;
	}
	if (escaped) current += "\\";
	if (current) push();
	return words;
}

function executableName(value: string): string {
	return value.split("/").at(-1) ?? value;
}

export function mergeCommand(
	command: string,
): { kind: "git" | "gh"; args: string[] } | null {
	const segments = shellSegments(command);
	if (segments?.length !== 1) return null;
	let parsed: { kind: "git" | "gh"; args: string[] } | null = null;
	for (const segment of segments) {
		const words = shellWords(segment);
		let candidate: { kind: "git" | "gh"; args: string[] } | null = null;
		if (
			words.length >= 2 &&
			executableName(words[0]) === "git" &&
			words[1] === "merge"
		) {
			candidate = { kind: "git", args: words.slice(2) };
		}
		if (
			words.length >= 3 &&
			executableName(words[0]) === "gh" &&
			words[1] === "pr" &&
			words[2] === "merge"
		) {
			candidate = { kind: "gh", args: words.slice(3) };
		}
		if (!candidate) continue;
		if (parsed) return null;
		parsed = candidate;
	}
	return parsed;
}

function positionalArgs(args: string[]): string[] {
	return args.filter((arg) => arg !== "--" && !arg.startsWith("-"));
}

const NON_COMPLETING_GIT_MERGE_OPTIONS = new Set(["--no-commit", "--squash"]);
const NON_COMPLETING_GH_MERGE_OPTIONS = new Set(["--auto", "--dry-run"]);

function hasNonCompletingMergeOption(
	kind: "git" | "gh",
	args: readonly string[],
): boolean {
	const options =
		kind === "git"
			? NON_COMPLETING_GIT_MERGE_OPTIONS
			: NON_COMPLETING_GH_MERGE_OPTIONS;
	for (const arg of args) {
		if (arg === "--") break;
		if (options.has(arg) || (kind === "gh" && arg.startsWith("--auto=")))
			return true;
	}
	return false;
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

function ghMergeTargets(args: string[]): string[] | null {
	const targets: string[] = [];
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--") {
			targets.push(...args.slice(index + 1));
			break;
		}
		if (arg === "--repo" || arg === "-R" || arg.startsWith("--repo="))
			return null;
		if (GH_MERGE_VALUE_OPTIONS.has(arg)) {
			index += 1;
			continue;
		}
		if (arg.startsWith("-")) {
			if (GH_MERGE_FLAG_OPTIONS.has(arg)) continue;
			if (index + 1 < args.length && !args[index + 1].startsWith("-"))
				return null;
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
	let result: CommandResult;
	try {
		result = await exec("gh", ["pr", "view", prUrl, "--json", "headRefName"], {
			cwd,
		});
	} catch {
		return null;
	}
	if (result.code !== 0) return null;
	try {
		const data: unknown = JSON.parse(result.stdout);
		return typeof data === "object" &&
			data !== null &&
			typeof (data as { headRefName?: unknown }).headRefName === "string"
			? (data as { headRefName: string }).headRefName
			: null;
	} catch {
		return null;
	}
}

async function queryCurrentPr(
	exec: Exec,
	cwd: string,
	target: string,
): Promise<{ url: string; headRefName: string } | null> {
	let result: CommandResult;
	try {
		result = await exec(
			"gh",
			["pr", "view", target, "--json", "url,headRefName"],
			{ cwd },
		);
	} catch {
		return null;
	}
	if (result.code !== 0) return null;
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
	if (!parsed || !pinned) return false;
	if (hasNonCompletingMergeOption(parsed.kind, parsed.args)) return false;

	if (parsed.kind === "gh") {
		const targets = ghMergeTargets(parsed.args);
		if (targets?.length !== 1) return false;
		const target = targets[0];
		if (normalizedUrl(target) === pinned) return true;
		const currentPr = await queryCurrentPr(exec, cwd, target);
		if (currentPr === null || normalizedUrl(currentPr.url) !== pinned)
			return false;
		return /^\d+$/.test(target) || currentPr.headRefName === target;
	}

	const targets = positionalArgs(parsed.args);
	if (targets.length !== 1) return false;
	const head = await queryPinnedHead(exec, cwd, pinned);
	return (
		head !== null &&
		(targets[0] === head || targets[0] === `refs/heads/${head}`)
	);
}
