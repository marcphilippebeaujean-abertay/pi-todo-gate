const OPEN_TASK_LABEL = "open";
const TODOIST_TASK_LABEL = "Todoist Task: ";
const FOOTER_SEPARATOR = " |";
const NONE_LABEL = "none";

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

export function renderTaskStatus(
	url: string | undefined,
	theme?: TodoistFooterTheme,
	taskName?: string,
): string {
	const muted = (text: string) => theme?.fg("muted", text) ?? text;
	const value = (text: string) => theme?.fg("text", text) ?? text;
	const createMutedTaskLabel = (taskValue: string): string =>
		`${muted(TODOIST_TASK_LABEL)}${taskValue}${muted(FOOTER_SEPARATOR)}`;
	const hasUrl = Boolean(url);
	if (!hasUrl) return createMutedTaskLabel(value(NONE_LABEL));
	const inputUrl = url ?? "";
	try {
		const parsed = new URL(inputUrl);
		const isSupportedProtocol =
			parsed.protocol === "http:" || parsed.protocol === "https:";
		if (!isSupportedProtocol) return createMutedTaskLabel(value(NONE_LABEL));
		const id = parsed.pathname.match(/\/task\/([^/]+)\/?$/)?.[1];
		return createMutedTaskLabel(
			hyperlink(linkText(displayTaskName(taskName, id), theme), inputUrl),
		);
	} catch {
		return createMutedTaskLabel(value(NONE_LABEL));
	}
}
