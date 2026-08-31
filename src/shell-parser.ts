type Char = "'" | '"' | "\\" | ";" | "|" | "&";
type QuoteCharacter = "'" | '"';

function isCharacter(character: string, expected: Char): boolean {
	return character === expected;
}

function isQuoteCharacter(character: string): character is QuoteCharacter {
	return isCharacter(character, "'") || isCharacter(character, '"');
}

function isEscapeCharacter(
	character: string,
	quote: QuoteCharacter | null,
): boolean {
	return isCharacter(character, "\\") && quote !== "'";
}

function isCommandSeparator(character: string): boolean {
	const isSemicolon = isCharacter(character, ";");
	if (isSemicolon) return true;
	const isPipe = isCharacter(character, "|");
	if (isPipe) return true;
	return isCharacter(character, "&");
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
	if (isEscaped) {
		state.current += character;
		state.escaped = false;
		return null;
	}
	const startsEscape = isEscapeCharacter(character, state.quote);
	if (startsEscape) {
		state.current += character;
		state.escaped = true;
		return null;
	}
	const isInsideQuote = state.quote !== null;
	if (isInsideQuote) {
		state.current += character;
		const closesQuote = state.quote === character;
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
	if (isEscaped) {
		state.current += character;
		state.escaped = false;
		return;
	}
	const startsEscape = isEscapeCharacter(character, state.quote);
	if (startsEscape) {
		state.escaped = true;
		return;
	}
	const isInsideQuote = state.quote !== null;
	if (isInsideQuote) {
		const closesQuote = state.quote === character;
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
