import {
	hyperlink,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";
import {
	type PrFooterTheme,
	renderPrLabel,
	renderPrStatus as renderPrStatusFromModule,
} from "./pr/footer.ts";

export interface FooterState {
	prUrl?: string;
	taskUrl?: string;
	taskName?: string;
	branch?: string | null;
}

export interface FooterTheme extends PrFooterTheme {
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
	if (!url) return "Todoist Task: none";
	try {
		const parsed = new URL(url);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
			return "Todoist Task: none";
		const id = parsed.pathname.match(/\/task\/([^/]+)\/?$/)?.[1];
		return `Todoist Task: ${hyperlink(linkText(displayTaskName(taskName, id), theme), url)}`;
	} catch {
		return "Todoist Task: none";
	}
}

export const renderPrStatus = renderPrStatusFromModule;

export function renderTaskStatus(
	url: string | undefined,
	theme?: FooterTheme,
	taskName?: string,
): string {
	const muted = (text: string) => theme?.fg("muted", text) ?? text;
	const value = (text: string) => theme?.fg("text", text) ?? text;
	if (!url) return `${muted("Todoist Task: ")}${value("none")}`;
	try {
		const parsed = new URL(url);
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
			return `${muted("Todoist Task: ")}${value("none")}`;
		const id = parsed.pathname.match(/\/task\/([^/]+)\/?$/)?.[1];
		return `${muted("Todoist Task: ")}${hyperlink(linkText(displayTaskName(taskName, id), theme), url)}`;
	} catch {
		return `${muted("Todoist Task: ")}${value("none")}`;
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
		renderPrLabel(state.prUrl, theme),
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
