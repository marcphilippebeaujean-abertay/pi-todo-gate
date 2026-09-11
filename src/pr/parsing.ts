import { z } from "zod";
import {
	CLOSED_STATE,
	END_OF_OPTIONS,
	GH_COMMAND,
	GH_MERGE_FLAG_OPTIONS,
	GH_MERGE_VALUE_OPTIONS,
	GIT_COMMAND,
	GIT_GLOBAL_FLAG_OPTIONS,
	GIT_GLOBAL_VALUE_OPTIONS,
	GIT_INLINE_GLOBAL_OPTION_RE,
	GIT_MERGE_VALUE_OPTIONS,
	MERGE_COMMAND,
	MERGED_STATE,
	NON_COMPLETING_GH_MERGE_OPTIONS,
	NON_COMPLETING_GIT_MERGE_OPTIONS,
	OPEN_STATE,
	PR_COMMAND,
	UNKNOWN_STATE,
} from "./constants.ts";
import type {
	MergedPr,
	OpenPrInfo,
	ParsedMerge,
	PrState,
	QuoteCharacter,
	ShellState,
} from "./state.ts";

const prStateSchema = z.enum([OPEN_STATE, CLOSED_STATE, MERGED_STATE]);

export const openPrRowSchema = z
	.object({
		url: z.string().optional(),
		state: prStateSchema.optional(),
	})
	.loose();

export const openPrRowsSchema = z.array(openPrRowSchema);

export const mergedPrDataSchema = z
	.object({
		state: prStateSchema.optional(),
		mergedAt: z.string().optional(),
	})
	.loose();

export const headRefSchema = z.object({ headRefName: z.string() }).loose();

export const currentPrSchema = z
	.object({
		url: z.string(),
		headRefName: z.string(),
	})
	.loose();

const mergedPrSchema = z.object({
	prUrl: z.string(),
	detectedAt: z.string(),
	reminderPending: z.boolean(),
});

export const prStateDataSchema = z
	.object({
		prUrl: z.string().optional(),
		mergedPrs: z.array(mergedPrSchema).optional(),
		discoveryDisabled: z.boolean().optional(),
	})
	.loose();

export function stateFromMergedData(data: unknown): OpenPrInfo["state"] {
	const parsed = mergedPrDataSchema.safeParse(data);
	const isInvalidData = !parsed.success;
	if (isInvalidData) return UNKNOWN_STATE;
	const row = parsed.data;
	const hasMergedAt = row.mergedAt !== undefined && row.mergedAt.trim() !== "";
	switch (row.state) {
		case MERGED_STATE:
			return hasMergedAt ? MERGED_STATE : UNKNOWN_STATE;
		case OPEN_STATE:
			return OPEN_STATE;
		case CLOSED_STATE:
			return CLOSED_STATE;
		default:
			return UNKNOWN_STATE;
	}
}

export function parseOpenPrResult(stdout: string): OpenPrInfo {
	try {
		const parsed = openPrRowsSchema.safeParse(JSON.parse(stdout));
		const isInvalidRows = !parsed.success;
		if (isInvalidRows) return { url: null, state: UNKNOWN_STATE };
		const hasNoRows = parsed.data.length === 0;
		if (hasNoRows) return { url: null, state: OPEN_STATE };
		const row = parsed.data[0];
		const hasNoRow = row === undefined;
		if (hasNoRow) return { url: null, state: UNKNOWN_STATE };
		const url = row.url === undefined ? null : githubPrUrl(row.url);
		let state: OpenPrInfo["state"];
		switch (row.state) {
			case OPEN_STATE:
				state = OPEN_STATE;
				break;
			case CLOSED_STATE:
				state = CLOSED_STATE;
				break;
			case MERGED_STATE:
				state = MERGED_STATE;
				break;
			default:
				state = UNKNOWN_STATE;
		}
		return { url, state };
	} catch {
		return { url: null, state: UNKNOWN_STATE };
	}
}

import {
	GITHUB_HOSTNAME,
	GITHUB_URL_PREFIX,
	PR_CANDIDATE,
	TRAILING_COMMAND_SEPARATOR_RE,
	TRAILING_PUNCTUATION,
} from "./constants.ts";

function normalizedGithubPrUrl(candidate: string): string | null {
	const trimmed = candidate.replace(TRAILING_PUNCTUATION, "");
	try {
		const url = new URL(trimmed);
		const hasGithubHostname = url.hostname.toLowerCase() === GITHUB_HOSTNAME;
		if (!hasGithubHostname) return null;
		const match = url.pathname.match(
			/^\/([^/]+)\/([^/]+)\/pull\/([1-9]\d*)\/?$/,
		);
		const hasMatch = Array.isArray(match);
		if (!hasMatch) return null;
		return `${GITHUB_URL_PREFIX}/${match[1]}/${match[2]}/pull/${match[3]}`;
	} catch {
		return null;
	}
}

export function githubPrUrls(text: string): string[] {
	const urls: string[] = [];
	for (const candidate of text.match(PR_CANDIDATE) ?? []) {
		const normalized = normalizedGithubPrUrl(candidate);
		const hasNormalized = normalized !== null;
		const shouldInclude = hasNormalized;
		if (shouldInclude) urls.push(normalized);
	}
	return urls;
}

export function githubPrUrl(text: string): string | null {
	return githubPrUrls(text)[0] ?? null;
}

export function firstGithubPrUrl(texts: readonly string[]): string | null {
	for (const text of texts) {
		const url = githubPrUrl(text);
		const hasUrl = url !== null;
		if (hasUrl) return url;
	}
	return null;
}

export function firstUnmergedGithubPrUrl(
	texts: readonly string[],
	mergedPrs: readonly string[],
): string | null {
	const merged = new Set(mergedPrs);
	for (const text of texts) {
		for (const url of githubPrUrls(text)) {
			const isUnmerged = !merged.has(url);
			if (isUnmerged) return url;
		}
	}
	return null;
}

function withoutPrUrl(entries: MergedPr[], prUrl: string): MergedPr[] {
	const result: MergedPr[] = [];
	for (const entry of entries) {
		const isSamePrUrl = entry.prUrl === prUrl;
		if (isSamePrUrl) continue;
		result.push(entry);
	}
	return result;
}

function hasPendingReminder(entry: MergedPr): boolean {
	return entry.reminderPending;
}

function clearReminder(entry: MergedPr): MergedPr {
	return { ...entry, reminderPending: false };
}

function prUrlOf(entry: MergedPr): string {
	return entry.prUrl;
}

export function isPrState(value: unknown): value is PrState {
	return prStateDataSchema.safeParse(value).success;
}

export function recordMergedPr(state: PrState, detectedAt: string): PrState {
	const prUrl = state.prUrl;
	if (prUrl === undefined) return state;
	const hasPrUrl = prUrl !== "";
	if (!hasPrUrl) return state;
	const existingMergedPrs = state.mergedPrs ?? [];
	const mergedPrs = [
		...withoutPrUrl(existingMergedPrs, prUrl),
		{ prUrl, detectedAt, reminderPending: true },
	];
	return { mergedPrs, discoveryDisabled: false };
}

export function markRemindersDelivered(state: PrState): PrState {
	const existingMergedPrs = state.mergedPrs;
	if (existingMergedPrs === undefined) return state;
	const hasPending = existingMergedPrs.some(hasPendingReminder);
	if (!hasPending) return state;
	return {
		...state,
		mergedPrs: existingMergedPrs.map(clearReminder),
	};
}

export function removeMergedPr(state: PrState, prUrl: string): PrState {
	const existingMergedPrs = state.mergedPrs;
	if (existingMergedPrs === undefined) return state;
	const mergedPrs = withoutPrUrl(existingMergedPrs, prUrl);
	const mergedPrsLength = mergedPrs.length;
	const hasSameLength = mergedPrsLength === existingMergedPrs.length;
	if (hasSameLength) return state;
	switch (mergedPrsLength) {
		case 0: {
			const { mergedPrs: _mergedPrs, ...next } = state;
			return next;
		}
		default:
			return { ...state, mergedPrs };
	}
}

export function mergedUrls(state: PrState): string[] {
	return state.mergedPrs?.map(prUrlOf) ?? [];
}

export function hasUnclosedQuote(command: string): boolean {
	let quote = "";
	for (const character of command) {
		const isQuote = character === "'" || character === '"';
		if (!isQuote) continue;
		const startsQuote = quote === "";
		if (startsQuote) quote = character;
		const closesExistingQuote = !startsQuote && quote === character;
		if (closesExistingQuote) quote = "";
	}
	return quote !== "";
}

function isQuoteCharacter(character: string): character is QuoteCharacter {
	return character === "'" || character === '"';
}

function isEscapeCharacter(
	character: string,
	quote: QuoteCharacter | null,
): boolean {
	return character === "\\" && quote !== "'";
}

function isCommandSeparator(character: string): boolean {
	switch (character) {
		case ";":
		case "|":
		case "&":
			return true;
		default:
			return false;
	}
}

function isShellWhitespace(character: string): boolean {
	return /\s/.test(character);
}

function consumeSegmentCharacter(
	state: ShellState,
	character: string,
): string | null {
	const isEscaped = state.escaped;
	const quote = state.quote;
	if (isEscaped) {
		state.current += character;
		state.escaped = false;
		return null;
	}
	const startsEscape = isEscapeCharacter(character, quote);
	if (startsEscape) {
		state.current += character;
		state.escaped = true;
		return null;
	}
	const isInsideQuote = quote !== null;
	if (isInsideQuote) {
		state.current += character;
		const closesQuote = quote === character;
		if (closesQuote) state.quote = null;
		return null;
	}
	const startsQuote = isQuoteCharacter(character);
	if (startsQuote) {
		state.quote = character;
		state.current += character;
		return null;
	}
	const isSeparator = isCommandSeparator(character);
	if (!isSeparator) {
		state.current += character;
		return null;
	}
	const segment = state.current.trim();
	state.current = "";
	return segment || null;
}

export function shellSegments(command: string): string[] {
	const segments: string[] = [];
	const state: ShellState = { current: "", quote: null, escaped: false };
	for (const character of command) {
		const segment = consumeSegmentCharacter(state, character);
		if (segment !== null) segments.push(segment);
	}
	const finalSegment = state.current.trim();
	const hasFinalSegment = finalSegment !== "";
	if (hasFinalSegment) segments.push(finalSegment);
	return segments;
}

function consumeWordCharacter(
	state: ShellState & { words: string[] },
	character: string,
): void {
	const isEscaped = state.escaped;
	const quote = state.quote;
	if (isEscaped) {
		state.current += character;
		state.escaped = false;
		return;
	}
	const startsEscape = isEscapeCharacter(character, quote);
	if (startsEscape) {
		state.escaped = true;
		return;
	}
	const isInsideQuote = quote !== null;
	if (isInsideQuote) {
		const closesQuote = quote === character;
		if (closesQuote) state.quote = null;
		else state.current += character;
		return;
	}
	const startsQuote = isQuoteCharacter(character);
	if (startsQuote) {
		state.quote = character;
		return;
	}
	const isWhitespace = isShellWhitespace(character);
	if (!isWhitespace) {
		state.current += character;
		return;
	}
	const shouldPushWord = Boolean(state.current || state.words.length === 0);
	if (shouldPushWord) state.words.push(state.current);
	state.current = "";
}

export function shellWords(segment: string): string[] {
	const state: ShellState & { words: string[] } = {
		current: "",
		quote: null,
		escaped: false,
		words: [],
	};
	for (const character of segment) consumeWordCharacter(state, character);
	const hasTrailingEscape = state.escaped;
	if (hasTrailingEscape) state.current += "\\";
	const hasCurrentWord = state.current !== "";
	if (hasCurrentWord) state.words.push(state.current);
	return state.words;
}

export function executableName(value: string): string {
	return value.split("/").at(-1) ?? value;
}

export function normalizedUrl(value: string): string | null {
	const candidate = value.match(PR_CANDIDATE)?.[0];
	const hasNoCandidate = candidate === undefined;
	if (hasNoCandidate) return null;
	try {
		const url = new URL(candidate.replace(TRAILING_PUNCTUATION, ""));
		const hasGithubHostname = url.hostname.toLowerCase() === GITHUB_HOSTNAME;
		if (!hasGithubHostname) return null;
		const match = url.pathname.match(
			/^\/([^/]+)\/([^/]+)\/pull\/([1-9]\d*)\/?$/,
		);
		const hasMatch = match !== null;
		return hasMatch
			? `${GITHUB_URL_PREFIX}/${match[1]}/${match[2]}/pull/${match[3]}`
			: null;
	} catch {
		return null;
	}
}

function gitMergeIndex(words: readonly string[]): number | null {
	for (let index = 1; index < words.length; index += 1) {
		const arg = words[index];
		const isMergeCommand = arg === MERGE_COMMAND;
		if (isMergeCommand) return index;
		const isValueOption = GIT_GLOBAL_VALUE_OPTIONS.has(arg ?? "");
		if (isValueOption) {
			index += 1;
			continue;
		}
		const hasInlineOption = GIT_INLINE_GLOBAL_OPTION_RE.test(arg ?? "");
		if (hasInlineOption) continue;
		const isFlagOption = GIT_GLOBAL_FLAG_OPTIONS.has(arg ?? "");
		if (isFlagOption) continue;
		return null;
	}
	return null;
}

function parseMergeWords(words: string[]): ParsedMerge | null {
	const hasTooFewWords = words.length < 2;
	if (hasTooFewWords) return null;
	const executable = executableName(words[0] ?? "");
	const isGit = executable === GIT_COMMAND;
	if (isGit) {
		const mergeIndex = gitMergeIndex(words);
		const hasMerge = mergeIndex !== null;
		if (hasMerge)
			return { kind: GIT_COMMAND, args: words.slice(mergeIndex + 1) };
		return null;
	}
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

export function mergeCommand(command: string): ParsedMerge | null {
	const hasTrailingSeparator = TRAILING_COMMAND_SEPARATOR_RE.test(command);
	if (hasTrailingSeparator) return null;
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
