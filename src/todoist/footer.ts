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
	if (name) return name.length > 15 ? `${name.slice(0, 15)}...` : name;
	return id ? `#${id}` : "open";
}

export function renderTaskStatus(
	url: string | undefined,
	theme?: TodoistFooterTheme,
	taskName?: string,
): string {
	const muted = (text: string) => theme?.fg("muted", text) ?? text;
	const value = (text: string) => theme?.fg("text", text) ?? text;
	if (!url) return `${muted("Todoist Task | ")}${value("none")}`;
	try {
		const parsed = new URL(url);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
			return `${muted("Todoist Task | ")}${value("none")}`;
		const id = parsed.pathname.match(/\/task\/([^/]+)\/?$/)?.[1];
		return `${muted("Todoist Task | ")}${hyperlink(linkText(displayTaskName(taskName, id), theme), url)}`;
	} catch {
		return `${muted("Todoist Task | ")}${value("none")}`;
	}
}
