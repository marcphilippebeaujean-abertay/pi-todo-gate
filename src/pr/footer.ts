const NO_PR_LABEL = "PR: none";
const PR_LINK_LABEL = "| PR Link: ";
const FOOTER_SEPARATOR = " |";

import { hyperlink } from "@earendil-works/pi-tui";
import { githubPrUrl } from "./detection.ts";

export interface PrFooterTheme {
	fg(color: string, text: string): string;
}

function linkText(text: string, theme?: PrFooterTheme): string {
	const colored = theme?.fg("accent", text) ?? `\u001b[34m${text}\u001b[39m`;
	return `\u001b[4m${colored}\u001b[24m`;
}

function prNumber(url: string | undefined): string | null {
	const hasUrl = Boolean(url);
	const normalized = hasUrl ? githubPrUrl(url as string) : null;
	const number = normalized?.match(/\/pull\/(\d+)$/)?.[1];
	return number ?? null;
}

function boundedPrNumber(number: string): string {
	const exceedsNumberLimit = number.length > 6;
	return exceedsNumberLimit ? `${number.slice(0, 5)}…` : number;
}

export function renderPrLabel(
	url: string | undefined,
	theme?: PrFooterTheme,
): string {
	const hasUrl = Boolean(url);
	const normalized = hasUrl ? githubPrUrl(url as string) : null;
	const number = prNumber(url);
	const hasNoPr = number === null || normalized === null;
	if (hasNoPr) return NO_PR_LABEL;
	return hyperlink(
		linkText(`PR #${boundedPrNumber(number)}`, theme),
		normalized,
	);
}

export function renderPrStatus(
	url: string | undefined,
	theme?: PrFooterTheme,
): string {
	const muted = (text: string) => theme?.fg("muted", text) ?? text;
	const value = (text: string) => theme?.fg("text", text) ?? text;
	const hasUrl = Boolean(url);
	const normalized = hasUrl ? githubPrUrl(url as string) : null;
	const number = prNumber(url);
	const hasNoPr = number === null || normalized === null;
	if (hasNoPr)
		return `${muted(PR_LINK_LABEL)}${value("none")}${muted(FOOTER_SEPARATOR)}`;
	return `${muted(PR_LINK_LABEL)}${hyperlink(linkText(`#${boundedPrNumber(number)}`, theme), normalized)}${muted(FOOTER_SEPARATOR)}`;
}
