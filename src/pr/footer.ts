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
	if (!number || !normalized) return "PR: none";
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
	const normalized = url ? githubPrUrl(url) : null;
	const number = prNumber(url);
	if (!number || !normalized)
		return `${muted("| PR Link: ")}${value("none")}${muted(" |")}`;
	return `${muted("| PR Link: ")}${hyperlink(linkText(`#${boundedPrNumber(number)}`, theme), normalized)}${muted(" |")}`;
}
