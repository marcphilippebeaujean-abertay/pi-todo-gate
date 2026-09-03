const STRING_LITERAL_ACCENT_49235C28 = "accent";
const STRING_LITERAL_OPEN_B1DCBA62 = "open";
const STRING_LITERAL_MUTED_5A6AC4CE = "muted";
const STRING_LITERAL_TEXT_59A1AFFE = "text";
const STRING_LITERAL_TODOIST_TASK_46EC00E2 = "Todoist Task: ";
const STRING_LITERAL_EMPTY_F4A1D044 = " |";
const STRING_LITERAL_NONE_C651E685 = "none";
const STRING_LITERAL_HTTP_COLON = "http:";
const STRING_LITERAL_HTTPS_COLON = "https:";

import { hyperlink } from "@earendil-works/pi-tui";

export interface TodoistFooterTheme {
	fg(color: string, text: string): string;
}

function linkText(text: string, theme?: TodoistFooterTheme): string {
	const colored =
		theme?.fg(STRING_LITERAL_ACCENT_49235C28, text) ??
		`\u001b[34m${text}\u001b[39m`;
	return `\u001b[4m${colored}\u001b[24m`;
}

function displayTaskName(
	taskName: string | undefined,
	id: string | undefined,
): string {
	const name = taskName?.replace(/\s+/g, " ").trim();
	if (name === undefined) return id ? `#${id}` : STRING_LITERAL_OPEN_B1DCBA62;
	const hasName = name !== "";
	if (hasName) return name.length > 15 ? `${name.slice(0, 15)}...` : name;
	return id ? `#${id}` : STRING_LITERAL_OPEN_B1DCBA62;
}

export function renderTaskStatus(
	url: string | undefined,
	theme?: TodoistFooterTheme,
	taskName?: string,
): string {
	const muted = (text: string) =>
		theme?.fg(STRING_LITERAL_MUTED_5A6AC4CE, text) ?? text;
	const value = (text: string) =>
		theme?.fg(STRING_LITERAL_TEXT_59A1AFFE, text) ?? text;
	const createMutedTaskLabel = (taskValue: string): string =>
		`${muted(STRING_LITERAL_TODOIST_TASK_46EC00E2)}${taskValue}${muted(STRING_LITERAL_EMPTY_F4A1D044)}`;
	const hasUrl = Boolean(url);
	if (!hasUrl) return createMutedTaskLabel(value(STRING_LITERAL_NONE_C651E685));
	const inputUrl = url ?? "";
	try {
		const parsed = new URL(inputUrl);
		const isSupportedProtocol =
			parsed.protocol === STRING_LITERAL_HTTP_COLON ||
			parsed.protocol === STRING_LITERAL_HTTPS_COLON;
		if (!isSupportedProtocol)
			return createMutedTaskLabel(value(STRING_LITERAL_NONE_C651E685));
		const id = parsed.pathname.match(/\/task\/([^/]+)\/?$/)?.[1];
		return createMutedTaskLabel(
			hyperlink(linkText(displayTaskName(taskName, id), theme), inputUrl),
		);
	} catch {
		return createMutedTaskLabel(value(STRING_LITERAL_NONE_C651E685));
	}
}
