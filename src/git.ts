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
					child.kill("SIGTERM");
				}, options.timeout)
			: undefined;
		const onAbort = () => {
			killed = true;
			child.kill("SIGTERM");
		};
		options.signal?.addEventListener("abort", onAbort, { once: true });
		child.stdout.on("data", (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});
		child.on("error", (error) => {
			if (timer) clearTimeout(timer);
			options.signal?.removeEventListener("abort", onAbort);
			finish({ stdout, stderr: `${stderr}${error.message}`, code: 1, killed });
		});
		child.on("close", (code) => {
			if (timer) clearTimeout(timer);
			options.signal?.removeEventListener("abort", onAbort);
			finish({ stdout, stderr, code: code ?? 1, killed });
		});
	});

function firstWorktreePath(output: string): string | null {
	const line = output
		.split(/\r?\n/)
		.find((value) => value.startsWith("worktree "));
	return line ? line.slice("worktree ".length).trim() : null;
}

export async function inspectWorktree(
	exec: Exec,
	cwd: string,
): Promise<WorktreeInfo> {
	const [rootResult, branchResult, listResult] = await Promise.all([
		exec("git", ["rev-parse", "--show-toplevel"], { cwd }),
		exec("git", ["branch", "--show-current"], { cwd }),
		exec("git", ["worktree", "list", "--porcelain"], { cwd }),
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
	return {
		isWorktree:
			root !== null && mainRoot !== null && root !== resolve(mainRoot),
		root,
		branch,
	};
}

export async function findOpenPr(
	exec: Exec,
	cwd: string,
	branch: string,
): Promise<OpenPrInfo> {
	const result = await exec(
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
		if (quote) {
			current += character;
			if (character === quote) quote = null;
			continue;
		}
		if (character === "'" || character === '"') {
			quote = character;
			current += character;
			continue;
		}
		if (character === ";" || character === "|" || character === "&") {
			if (current.trim()) segments.push(current.trim());
			current = "";
			continue;
		}
		current += character;
	}
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
	let parsed: { kind: "git" | "gh"; args: string[] } | null = null;
	for (const segment of shellSegments(command)) {
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

function normalizedUrl(value: string): string | null {
	return githubPrUrl(value);
}

async function queryPinnedHead(
	exec: Exec,
	cwd: string,
	prUrl: string,
): Promise<string | null> {
	const result = await exec(
		"gh",
		["pr", "view", prUrl, "--json", "headRefName"],
		{ cwd },
	);
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
	const result = await exec(
		"gh",
		["pr", "view", target, "--json", "url,headRefName"],
		{ cwd },
	);
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

	if (parsed.kind === "gh") {
		if (parsed.args.some((arg) => normalizedUrl(arg) === pinned)) return true;
		const targets = positionalArgs(parsed.args);
		if (targets.length !== 1) return false;
		const target = targets[0];
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
