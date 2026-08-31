const STRING_LITERAL_ACCENT_2B526673 = "accent";
const STRING_LITERAL_PR_NONE_1D5B0664 = "PR: none";
const STRING_LITERAL_MUTED_5970FB58 = "muted";
const STRING_LITERAL_TEXT_7E3621F6 = "text";
const STRING_LITERAL_PR_LINK_595A8DB4 = "| PR Link: ";
const STRING_LITERAL_NONE_D461DC85 = "none";
const STRING_LITERAL_EMPTY_C922F3DA = " |";

import { hyperlink } from "@earendil-works/pi-tui";
import { githubPrUrl } from "./detection.ts";

export interface PrFooterTheme {
	fg(color: string, text: string): string;
}

function linkText(text: string, theme?: PrFooterTheme): string {
	const colored =
		theme?.fg(STRING_LITERAL_ACCENT_2B526673, text) ??
		`\u001b[34m${text}\u001b[39m`;
	return `\u001b[4m${colored}\u001b[24m`;
}

function prNumber(url: string | undefined): string | null {
	const normalized = url ? githubPrUrl(url) : null;
	const number = normalized?.match(/\/pull\/(\d+)$/)?.[1];
	return number ?? null;
}

function boundedPrNumber(number: string): string {
	return number.length > 6 ? `${number.slice(0, 5)}…` : number;
}

export function renderPrLabel(
	url: string | undefined,
	theme?: PrFooterTheme,
): string {
	const normalized = url ? githubPrUrl(url) : null;
	const number = prNumber(url);
	if (!number || !normalized) return STRING_LITERAL_PR_NONE_1D5B0664;
	return hyperlink(
		linkText(`PR #${boundedPrNumber(number)}`, theme),
		normalized,
	);
}

export function renderPrStatus(
	url: string | undefined,
	theme?: PrFooterTheme,
): string {
	const muted = (text: string) =>
		theme?.fg(STRING_LITERAL_MUTED_5970FB58, text) ?? text;
	const value = (text: string) =>
		theme?.fg(STRING_LITERAL_TEXT_7E3621F6, text) ?? text;
	const normalized = url ? githubPrUrl(url) : null;
	const number = prNumber(url);
	if (!number || !normalized)
		return `${muted(STRING_LITERAL_PR_LINK_595A8DB4)}${value(STRING_LITERAL_NONE_D461DC85)}${muted(STRING_LITERAL_EMPTY_C922F3DA)}`;
	return `${muted(STRING_LITERAL_PR_LINK_595A8DB4)}${hyperlink(linkText(`#${boundedPrNumber(number)}`, theme), normalized)}${muted(STRING_LITERAL_EMPTY_C922F3DA)}`;
}
