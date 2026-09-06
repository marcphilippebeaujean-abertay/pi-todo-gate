const OPEN_TASK_LABEL = "open";
const TODOIST_TASK_LABEL = "Todoist Task: ";
const TASK_NONE_LABEL = "Todoist Task: none";
const FOOTER_SEPARATOR = " |";
const NONE_LABEL = "none";
const HTTP_PROTOCOL = "http:";
const HTTPS_PROTOCOL = "https:";

import { hyperlink } from "@earendil-works/pi-tui";

export interface TodoistFooterTheme {
	fg(color: string, text: string): string;
}

function linkText(text: string, theme?: TodoistFooterTheme): string {
	const colored = theme?.fg("accent", text) ?? `\u001b[34m${text}\u001b[39m`;
	return `\u001b[4m${colored}\u001b[24m`;
}

function displayTaskName(
	taskName: string | undefined,
	id: string | undefined,
): string {
	const name = taskName?.replace(/\s+/g, " ").trim();
	const hasId = id !== undefined;
	if (name === undefined) return hasId ? `#${id}` : OPEN_TASK_LABEL;
	const hasName = name !== "";
	const exceedsNameLimit = name.length > 15;
	if (hasName) return exceedsNameLimit ? `${name.slice(0, 15)}...` : name;
	return hasId ? `#${id}` : OPEN_TASK_LABEL;
}

export function renderTaskLabel(
	url: string | undefined,
	theme?: TodoistFooterTheme,
	taskName?: string,
): string {
	const hasUrl = Boolean(url);
	if (!hasUrl) return TASK_NONE_LABEL;
	const inputUrl = url ?? "";
	try {
		const parsed = new URL(inputUrl);
		const protocol = parsed.protocol;
		const isSupportedProtocol =
			protocol === HTTP_PROTOCOL || protocol === HTTPS_PROTOCOL;
		if (!isSupportedProtocol) return TASK_NONE_LABEL;
		const id = parsed.pathname.match(/\/task\/([^/]+)\/?$/)?.[1];
		return `${TODOIST_TASK_LABEL}${hyperlink(linkText(displayTaskName(taskName, id), theme), inputUrl)}`;
	} catch {
		return TASK_NONE_LABEL;
	}
}

function renderTaskStatusValue(
	url: string | undefined,
	theme: TodoistFooterTheme | undefined,
	taskName: string | undefined,
	includeSeparator: boolean,
): string {
	const muted = (text: string) => theme?.fg("muted", text) ?? text;
	const value = (text: string) => theme?.fg("text", text) ?? text;
	const createTaskLabel = (taskValue: string): string => {
		const suffix = includeSeparator ? muted(FOOTER_SEPARATOR) : "";
		return `${muted(TODOIST_TASK_LABEL)}${taskValue}${suffix}`;
	};
	const hasUrl = Boolean(url);
	if (!hasUrl) return createTaskLabel(value(NONE_LABEL));
	const inputUrl = url ?? "";
	try {
		const parsed = new URL(inputUrl);
		const protocol = parsed.protocol;
		const isSupportedProtocol =
			protocol === HTTP_PROTOCOL || protocol === HTTPS_PROTOCOL;
		if (!isSupportedProtocol) return createTaskLabel(value(NONE_LABEL));
		const id = parsed.pathname.match(/\/task\/([^/]+)\/?$/)?.[1];
		return createTaskLabel(
			hyperlink(linkText(displayTaskName(taskName, id), theme), inputUrl),
		);
	} catch {
		return createTaskLabel(value(NONE_LABEL));
	}
}

export function renderTaskStatus(
	url: string | undefined,
	theme?: TodoistFooterTheme,
	taskName?: string,
): string {
	return renderTaskStatusValue(url, theme, taskName, true);
}

export function renderTaskStatusCompact(
	url: string | undefined,
	theme?: TodoistFooterTheme,
	taskName?: string,
): string {
	return renderTaskStatusValue(url, theme, taskName, false);
}
