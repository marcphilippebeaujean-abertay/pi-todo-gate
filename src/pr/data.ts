import { z } from "zod";

const OPEN_STATE = "OPEN";
const CLOSED_STATE = "CLOSED";
const MERGED_STATE = "MERGED";

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

const PR_CANDIDATE = /https?:\/\/github\.com\/[^\s<>"']+/gi;
const TRAILING_PUNCTUATION = /[.,;:!?)}\]]+$/g;

function normalizedGithubPrUrl(candidate: string): string | null {
	const trimmed = candidate.replace(TRAILING_PUNCTUATION, "");
	try {
		const url = new URL(trimmed);
		const hasGithubHostname = url.hostname.toLowerCase() === "github.com";
		if (!hasGithubHostname) return null;
		const match = url.pathname.match(
			/^\/([^/]+)\/([^/]+)\/pull\/([1-9]\d*)\/?$/,
		);
		const hasMatch = Array.isArray(match);
		if (!hasMatch) return null;
		return `https://github.com/${match[1]}/${match[2]}/pull/${match[3]}`;
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

export const PR_STATE_TYPE = "pi-pr-gate-state";

export interface MergedPr {
	prUrl: string;
	detectedAt: string;
	reminderPending: boolean;
}

export interface PrState {
	prUrl?: string;
	mergedPrs?: MergedPr[];
	discoveryDisabled?: boolean;
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

type QuoteCharacter = "'" | '"';

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

interface ShellState {
	current: string;
	quote: QuoteCharacter | null;
	escaped: boolean;
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
