const ACCENT_COLOR = "accent";
const PR_NONE_LABEL = "PR: none";
const TASK_NONE_LABEL = "Todoist Task: none";
const HTTP_PROTOCOL = "http:";
const HTTPS_PROTOCOL = "https:";
const MUTED_COLOR = "muted";
const TEXT_COLOR = "text";
const PR_LINK_LABEL = "| PR Link: ";
const NONE_VALUE = "none";
const OPEN_VALUE = "open";
const LINK_SEPARATOR_SUFFIX = " |";
const TODOIST_TASK_LABEL = "Todoist Task: ";

import { hyperlink } from "@earendil-works/pi-tui";
import type { FooterTheme } from "./footer.ts";
import { githubPrUrl } from "./pr-detection.ts";

function linkText(text: string, theme?: FooterTheme): string {
	const colored =
		theme?.fg(ACCENT_COLOR, text) ?? `\u001b[34m${text}\u001b[39m`;
	return `\u001b[4m${colored}\u001b[24m`;
}

export function prLabel(url: string | undefined, theme?: FooterTheme): string {
	const hasUrl = Boolean(url);
	const normalized = hasUrl ? githubPrUrl(url as string) : null;
	const number = normalized?.match(/\/pull\/(\d+)$/)?.[1];
	if (normalized === null) return PR_NONE_LABEL;
	if (number === undefined) return PR_NONE_LABEL;
	const exceedsNumberLimit = number.length > 6;
	const boundedNumber = exceedsNumberLimit
		? `${(number as string).slice(0, 5)}…`
		: number;
	return hyperlink(linkText(`PR #${boundedNumber}`, theme), normalized);
}

function displayTaskName(
	taskName: string | undefined,
	id: string | undefined,
): string {
	const name = taskName?.replace(/\s+/g, " ").trim();
	const hasNoName = name === undefined || name === "";
	if (hasNoName) {
		const hasId = id !== undefined;
		return hasId ? `#${id}` : OPEN_VALUE;
	}
	const exceedsNameLimit = name.length > 15;
	return exceedsNameLimit ? `${name.slice(0, 15)}...` : name;
}

export function taskLabel(
	url: string | undefined,
	taskName?: string,
	theme?: FooterTheme,
): string {
	if (url === undefined) return TASK_NONE_LABEL;
	try {
		const parsed = new URL(url);
		const hasSupportedProtocol =
			parsed.protocol === HTTP_PROTOCOL || parsed.protocol === HTTPS_PROTOCOL;
		if (!hasSupportedProtocol) return TASK_NONE_LABEL;
		const id = parsed.pathname.match(/\/task\/([^/]+)\/?$/)?.[1];
		return `${TODOIST_TASK_LABEL}${hyperlink(linkText(displayTaskName(taskName, id), theme), url)}`;
	} catch {
		return TASK_NONE_LABEL;
	}
}

export function renderPrStatus(
	url: string | undefined,
	theme?: FooterTheme,
): string {
	const muted = (text: string) => theme?.fg(MUTED_COLOR, text) ?? text;
	const value = (text: string) => theme?.fg(TEXT_COLOR, text) ?? text;
	const hasUrl = Boolean(url);
	const normalized = hasUrl ? githubPrUrl(url as string) : null;
	const number = normalized?.match(/\/pull\/(\d+)$/)?.[1];
	if (normalized === null)
		return `${muted(PR_LINK_LABEL)}${value(NONE_VALUE)}${muted(LINK_SEPARATOR_SUFFIX)}`;
	if (number === undefined)
		return `${muted(PR_LINK_LABEL)}${value(NONE_VALUE)}${muted(LINK_SEPARATOR_SUFFIX)}`;
	const exceedsNumberLimit = number.length > 6;
	const boundedNumber = exceedsNumberLimit
		? `${(number as string).slice(0, 5)}…`
		: number;
	return `${muted(PR_LINK_LABEL)}${hyperlink(linkText(`#${boundedNumber}`, theme), normalized)}${muted(LINK_SEPARATOR_SUFFIX)}`;
}

export function renderTaskStatus(
	url: string | undefined,
	theme?: FooterTheme,
	taskName?: string,
): string {
	const muted = (text: string) => theme?.fg(MUTED_COLOR, text) ?? text;
	const value = (text: string) => theme?.fg(TEXT_COLOR, text) ?? text;
	const hasNoUrl = url === undefined;
	if (hasNoUrl) return `${muted(TODOIST_TASK_LABEL)}${value(NONE_VALUE)}`;
	try {
		const parsed = new URL(url);
		const hasSupportedProtocol =
			parsed.protocol === HTTP_PROTOCOL || parsed.protocol === HTTPS_PROTOCOL;
		if (!hasSupportedProtocol)
			return `${muted(TODOIST_TASK_LABEL)}${value(NONE_VALUE)}`;
		const id = parsed.pathname.match(/\/task\/([^/]+)\/?$/)?.[1];
		return `${muted(TODOIST_TASK_LABEL)}${hyperlink(linkText(displayTaskName(taskName, id), theme), url)}`;
	} catch {
		return `${muted(TODOIST_TASK_LABEL)}${value(NONE_VALUE)}`;
	}
}
