const PR_LINK_LABEL = "| PR Link: ";
const NO_PR_LABEL = "PR: none";
const FOOTER_SEPARATOR = " |";
const HTTPS_PROTOCOL = "https:";

import { hyperlink } from "@earendil-works/pi-tui";

interface FooterTheme {
	fg(color: string, text: string): string;
}

function normalizedPrUrl(value: string | undefined): string | null {
	const hasValue = value !== undefined;
	if (!hasValue) return null;
	try {
		const url = new URL(value);
		const isHttps = url.protocol === HTTPS_PROTOCOL;
		if (!isHttps) return null;
		const isGithub = url.hostname.toLowerCase() === "github.com";
		if (!isGithub) return null;
		const match = url.pathname.match(/^\/[^/]+\/[^/]+\/pull\/([1-9]\d*)\/?$/);
		const hasMatch = match !== null;
		return hasMatch
			? `https://github.com${url.pathname.replace(/\/$/, "")}`
			: null;
	} catch {
		return null;
	}
}

function linkText(text: string, theme?: FooterTheme): string {
	const colored = theme?.fg("accent", text) ?? `\u001b[34m${text}\u001b[39m`;
	return `\u001b[4m${colored}\u001b[24m`;
}

function prNumber(url: string | undefined): string | null {
	const normalized = normalizedPrUrl(url);
	return normalized?.match(/\/pull\/(\d+)$/)?.[1] ?? null;
}

function boundedPrNumber(number: string): string {
	const exceedsNumberLimit = number.length > 6;
	return exceedsNumberLimit ? `${number.slice(0, 5)}…` : number;
}

export function renderPrLabel(
	url: string | undefined,
	theme?: FooterTheme,
): string {
	const normalized = normalizedPrUrl(url);
	const number = prNumber(url);
	const hasNoPr = normalized === null || number === null;
	if (hasNoPr) return NO_PR_LABEL;
	return hyperlink(
		linkText(`PR #${boundedPrNumber(number)}`, theme),
		normalized,
	);
}

export function renderPrStatus(
	url: string | undefined,
	theme?: FooterTheme,
	hasUncommittedChanges = false,
): string {
	const normalized = normalizedPrUrl(url);
	const number = prNumber(url);
	const muted = (text: string) => theme?.fg("muted", text) ?? text;
	const value = (text: string) => theme?.fg("text", text) ?? text;
	const hasNoPr = normalized === null || number === null;
	if (hasNoPr)
		return `${muted(PR_LINK_LABEL)}${value("none")}${muted(FOOTER_SEPARATOR)}`;
	const dirtyMarker = hasUncommittedChanges ? "*" : "";
	return `${muted(PR_LINK_LABEL)}${hyperlink(linkText(`#${boundedPrNumber(number)}${dirtyMarker}`, theme), normalized)}${muted(FOOTER_SEPARATOR)}`;
}
