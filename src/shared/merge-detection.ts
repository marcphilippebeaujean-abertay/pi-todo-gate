const STRING_LITERAL_GIT_9B1A99C5 = "git";
const STRING_LITERAL_GH_24B57162 = "gh";
const STRING_LITERAL_EMPTY_9BE26789 = "--";
const STRING_LITERAL_AUTO_4D4984CD = "--auto=";
const STRING_LITERAL_MESSAGE_13B76A3B = "--message=";
const STRING_LITERAL_STRATEGY_B926ECFC = "--strategy=";
const STRING_LITERAL_STRATEGY_OPTION_06BF219B = "--strategy-option=";
const STRING_LITERAL_INTO_NAME_855E789E = "--into-name=";
const STRING_LITERAL_M_1BD00714 = "-m";
const STRING_LITERAL_REPO_7E2CEA50 = "--repo";
const STRING_LITERAL_R_29191392 = "-R";
const STRING_LITERAL_REPO_889373A1 = "--repo=";
const STRING_LITERAL_GITHUB_COM_7A4F50A3 = "github.com";
const STRING_LITERAL_PR_BE5834CA = "pr";
const STRING_LITERAL_VIEW_C69C8EE7 = "view";
const STRING_LITERAL_JSON_C54094BE = "--json";
const STRING_LITERAL_HEADREFNAME_582A7721 = "headRefName";
const STRING_LITERAL_URL_HEADREFNAME_E699868E = "url,headRefName";

import type { CommandResult, Exec } from "./command.ts";

export interface MergeEvent {
	prUrl: string;
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
			const hasCurrent = current !== "";
			if (hasCurrent) push();
			continue;
		}
		current += character;
	}
	if (escaped) current += "\\";
	const hasCurrent = current !== "";
	if (hasCurrent) push();
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
			executableName(words[0]) === STRING_LITERAL_GIT_9B1A99C5 &&
			words[1] === "merge"
		) {
			candidate = { kind: STRING_LITERAL_GIT_9B1A99C5, args: words.slice(2) };
		}
		if (
			words.length >= 3 &&
			executableName(words[0]) === STRING_LITERAL_GH_24B57162 &&
			words[1] === "pr" &&
			words[2] === "merge"
		) {
			candidate = { kind: STRING_LITERAL_GH_24B57162, args: words.slice(3) };
		}
		if (!candidate) continue;
		if (parsed) return null;
		parsed = candidate;
	}
	return parsed;
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

function hasNonCompletingMergeOption(
	kind: "git" | "gh",
	args: readonly string[],
): boolean {
	const options =
		kind === STRING_LITERAL_GIT_9B1A99C5
			? NON_COMPLETING_GIT_MERGE_OPTIONS
			: NON_COMPLETING_GH_MERGE_OPTIONS;
	for (const arg of args) {
		if (arg === STRING_LITERAL_EMPTY_9BE26789) break;
		if (
			options.has(arg) ||
			(kind === STRING_LITERAL_GH_24B57162 &&
				arg.startsWith(STRING_LITERAL_AUTO_4D4984CD))
		)
			return true;
	}
	return false;
}

function gitMergeTargets(args: string[]): string[] {
	const targets: string[] = [];
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === STRING_LITERAL_EMPTY_9BE26789) {
			targets.push(...args.slice(index + 1));
			break;
		}
		if (GIT_MERGE_VALUE_OPTIONS.has(arg)) {
			index += 1;
			continue;
		}
		if (
			arg.startsWith(STRING_LITERAL_MESSAGE_13B76A3B) ||
			arg.startsWith(STRING_LITERAL_STRATEGY_B926ECFC) ||
			arg.startsWith(STRING_LITERAL_STRATEGY_OPTION_06BF219B) ||
			arg.startsWith(STRING_LITERAL_INTO_NAME_855E789E) ||
			arg.startsWith(STRING_LITERAL_M_1BD00714)
		)
			continue;
		if (!arg.startsWith("-")) targets.push(arg);
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

function ghMergeTargets(args: string[]): string[] | null {
	const targets: string[] = [];
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === STRING_LITERAL_EMPTY_9BE26789) {
			targets.push(...args.slice(index + 1));
			break;
		}
		if (
			arg === STRING_LITERAL_REPO_7E2CEA50 ||
			arg === STRING_LITERAL_R_29191392 ||
			arg.startsWith(STRING_LITERAL_REPO_889373A1)
		)
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
	const candidate = value.match(/https?:\/\/github\.com\/[^\s<>"']+/i)?.[0];
	if (!candidate) return null;
	try {
		const url = new URL(candidate.replace(/[.,;:!?)}\]]+$/g, ""));
		if (url.hostname.toLowerCase() !== STRING_LITERAL_GITHUB_COM_7A4F50A3)
			return null;
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

async function queryPinnedHead(
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

	const targets = gitMergeTargets(parsed.args);
	if (targets.length !== 1) return false;
	const head = await queryPinnedHead(exec, cwd, pinned);
	return (
		head !== null &&
		(targets[0] === head || targets[0] === `refs/heads/${head}`)
	);
}

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
