const ACCENT = "accent";
const PR_NONE = "PR: none";
const SPACE = " ";
const OPEN = "open";
const TODOIST_TASK_NONE = "Todoist Task: none";
const HTTP = "http:";
const HTTPS = "https:";
const MUTED = "muted";
const TEXT = "text";
const PR_LINK = "| PR Link: ";
const NONE = "none";
const TEXT_2 = " |";
const TODOIST_TASK = "Todoist Task: ";
const EMPTY_STRING = "";
const DIM = "dim";
const TEXT_3 = " | ";

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
	const colored = theme?.fg(ACCENT, text) ?? `\u001b[34m${text}\u001b[39m`;
	return `\u001b[4m${colored}\u001b[24m`;
}

function prLabel(url: string | undefined, theme?: FooterTheme): string {
	const normalized = url ? githubPrUrl(url) : null;
	const number = normalized?.match(/\/pull\/(\d+)$/)?.[1];
	if (!number) return PR_NONE;
	const boundedNumber = number.length > 6 ? `${number.slice(0, 5)}…` : number;
	return hyperlink(linkText(`PR #${boundedNumber}`, theme), normalized);
}

function displayTaskName(
	taskName: string | undefined,
	id: string | undefined,
): string {
	const name = taskName?.replace(/\s+/g, SPACE).trim();
	if (name) return name.length > 15 ? `${name.slice(0, 15)}...` : name;
	return id ? `#${id}` : OPEN;
}

function taskLabel(
	url: string | undefined,
	taskName?: string,
	theme?: FooterTheme,
): string {
	if (!url) return TODOIST_TASK_NONE;
	try {
		const parsed = new URL(url);
		if (parsed.protocol !== HTTP && parsed.protocol !== HTTPS)
			return TODOIST_TASK_NONE;
		const id = parsed.pathname.match(/\/task\/([^/]+)\/?$/)?.[1];
		return `Todoist Task: ${hyperlink(linkText(displayTaskName(taskName, id), theme), url)}`;
	} catch {
		return TODOIST_TASK_NONE;
	}
}

export function renderPrStatus(
	url: string | undefined,
	theme?: FooterTheme,
): string {
	const muted = (text: string) => theme?.fg(MUTED, text) ?? text;
	const value = (text: string) => theme?.fg(TEXT, text) ?? text;
	const normalized = url ? githubPrUrl(url) : null;
	const number = normalized?.match(/\/pull\/(\d+)$/)?.[1];
	if (!number) return `${muted(PR_LINK)}${value(NONE)}${muted(TEXT_2)}`;
	const boundedNumber = number.length > 6 ? `${number.slice(0, 5)}…` : number;
	return `${muted(PR_LINK)}${hyperlink(linkText(`#${boundedNumber}`, theme), normalized)}${muted(TEXT_2)}`;
}

export function renderTaskStatus(
	url: string | undefined,
	theme?: FooterTheme,
	taskName?: string,
): string {
	const muted = (text: string) => theme?.fg(MUTED, text) ?? text;
	const value = (text: string) => theme?.fg(TEXT, text) ?? text;
	if (!url) return `${muted(TODOIST_TASK)}${value(NONE)}`;
	try {
		const parsed = new URL(url);
		if (parsed.protocol !== HTTP && parsed.protocol !== HTTPS)
			return `${muted(TODOIST_TASK)}${value(NONE)}`;
		const id = parsed.pathname.match(/\/task\/([^/]+)\/?$/)?.[1];
		return `${muted(TODOIST_TASK)}${hyperlink(linkText(displayTaskName(taskName, id), theme), url)}`;
	} catch {
		return `${muted(TODOIST_TASK)}${value(NONE)}`;
	}
}

export function renderFooterLine(
	state: FooterState,
	width: number,
	theme: FooterTheme,
	statuses: ReadonlyMap<string, string>,
): string {
	if (width <= 0) return EMPTY_STRING;
	const parts = [
		prLabel(state.prUrl, theme),
		taskLabel(state.taskUrl, state.taskName, theme),
	];
	if (state.branch) parts.push(`branch: ${state.branch}`);
	for (const status of statuses.values()) {
		if (status) parts.push(status);
	}
	const line = theme.fg(DIM, parts.join(TEXT_3));
	if (visibleWidth(line) <= width) return line;
	return truncateToWidth(line, width, EMPTY_STRING, false);
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
