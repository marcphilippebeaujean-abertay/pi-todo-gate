import {
	hyperlink,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";
import { githubPrUrl } from "./pr-detection.ts";

export interface FooterState {
	prUrl?: string;
	taskUrl?: string;
	taskName?: string;
	branch?: string | null;
}

export interface FooterTheme {
	fg(color: string, text: string): string;
}

export interface FooterData {
	getExtensionStatuses(): ReadonlyMap<string, string>;
	getGitBranch?(): string | null | undefined;
	onBranchChange(listener: () => void): () => void;
}

export interface FooterTui {
	requestRender(): void;
}

export interface FooterComponent {
	dispose(): void;
	invalidate(): void;
	render(width: number): string[];
}

export type FooterFactory = (
	tui: FooterTui,
	theme: FooterTheme,
	footerData: FooterData,
) => FooterComponent;

function linkText(text: string, theme?: FooterTheme): string {
	const colored = theme?.fg("accent", text) ?? `\u001b[34m${text}\u001b[39m`;
	return `\u001b[4m${colored}\u001b[24m`;
}

function prLabel(url: string | undefined, theme?: FooterTheme): string {
	const normalized = url ? githubPrUrl(url) : null;
	const number = normalized?.match(/\/pull\/(\d+)$/)?.[1];
	if (!number) return "PR: none";
	const boundedNumber = number.length > 6 ? `${number.slice(0, 5)}…` : number;
	return hyperlink(linkText(`PR #${boundedNumber}`, theme), normalized);
}

function displayTaskName(
	taskName: string | undefined,
	id: string | undefined,
): string {
	const name = taskName?.replace(/\s+/g, " ").trim();
	if (name) return name.length > 15 ? `${name.slice(0, 15)}...` : name;
	return id ? `#${id}` : "open";
}

function taskLabel(
	url: string | undefined,
	taskName?: string,
	theme?: FooterTheme,
): string {
	if (!url) return "Task: none";
	try {
		const parsed = new URL(url);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
			return "Task: none";
		const id = parsed.pathname.match(/\/task\/([^/]+)\/?$/)?.[1];
		return `Task: ${hyperlink(linkText(displayTaskName(taskName, id), theme), url)}`;
	} catch {
		return "Task: none";
	}
}

export function renderPrStatus(
	url: string | undefined,
	theme?: FooterTheme,
): string {
	const muted = (text: string) => theme?.fg("muted", text) ?? text;
	const value = (text: string) => theme?.fg("text", text) ?? text;
	const normalized = url ? githubPrUrl(url) : null;
	const number = normalized?.match(/\/pull\/(\d+)$/)?.[1];
	if (!number) return `${muted("| PR Link: ")}${value("none")}${muted(" |")}`;
	const boundedNumber = number.length > 6 ? `${number.slice(0, 5)}…` : number;
	return `${muted("| PR Link: ")}${hyperlink(linkText(`#${boundedNumber}`, theme), normalized)}${muted(" |")}`;
}

export function renderTaskStatus(
	url: string | undefined,
	theme?: FooterTheme,
	taskName?: string,
): string {
	const muted = (text: string) => theme?.fg("muted", text) ?? text;
	const value = (text: string) => theme?.fg("text", text) ?? text;
	if (!url) return `${muted("Task: ")}${value("none")}`;
	try {
		const parsed = new URL(url);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
			return `${muted("Task: ")}${value("none")}`;
		const id = parsed.pathname.match(/\/task\/([^/]+)\/?$/)?.[1];
		return `${muted("Task: ")}${hyperlink(linkText(displayTaskName(taskName, id), theme), url)}`;
	} catch {
		return `${muted("Task: ")}${value("none")}`;
	}
}

export function renderFooterLine(
	state: FooterState,
	width: number,
	theme: FooterTheme,
	statuses: ReadonlyMap<string, string>,
): string {
	if (width <= 0) return "";
	const parts = [
		prLabel(state.prUrl, theme),
		taskLabel(state.taskUrl, state.taskName, theme),
	];
	if (state.branch) parts.push(`branch: ${state.branch}`);
	for (const status of statuses.values()) {
		if (status) parts.push(status);
	}
	const line = theme.fg("dim", parts.join(" | "));
	if (visibleWidth(line) <= width) return line;
	return truncateToWidth(line, width, "", false);
}

export function createFooterFactory(state: () => FooterState): FooterFactory {
	return (tui, theme, footerData) => {
		const unsubscribe = footerData.onBranchChange(() => tui.requestRender());
		return {
			dispose: unsubscribe,
			invalidate() {},
			render(width: number): string[] {
				const currentState = state();
				const branch = currentState.branch ?? footerData.getGitBranch?.();
				return [
					renderFooterLine(
						{ ...currentState, branch },
						width,
						theme,
						footerData.getExtensionStatuses(),
					),
				];
			},
		};
	};
}
