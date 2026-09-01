const DIM = "dim";
const STATUS_SEPARATOR = " | ";

import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { prLabel, taskLabel } from "./footer-status.ts";

export { renderPrStatus, renderTaskStatus } from "./footer-status.ts";

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

export function renderFooterLine(
	state: FooterState,
	width: number,
	theme: FooterTheme,
	statuses: ReadonlyMap<string, string>,
): string {
	const hasNoWidth: boolean = !!(width <= 0);
	if (hasNoWidth) return "";
	const parts = [
		prLabel(state.prUrl, theme),
		taskLabel(state.taskUrl, state.taskName, theme),
	];
	const hasBranch: boolean = !!state.branch;
	if (hasBranch) parts.push(`branch: ${state.branch}`);
	for (const status of statuses.values()) {
		const hasStatus: boolean = !!status;
		if (hasStatus) parts.push(status);
	}
	const line = theme.fg(DIM, parts.join(STATUS_SEPARATOR));
	const fitsWidth: boolean = !!(visibleWidth(line) <= width);
	if (fitsWidth) return line;
	return truncateToWidth(line, width, "", false);
}

function noop(): void {}

function requestRender(tui: FooterTui): () => void {
	return () => tui.requestRender();
}

function renderFooterComponent(
	state: () => FooterState,
	footerData: FooterData,
	theme: FooterTheme,
	width: number,
): string[] {
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
}

export function createFooterFactory(state: () => FooterState): FooterFactory {
	return (tui, theme, footerData) => {
		const unsubscribe = footerData.onBranchChange(requestRender(tui));
		return {
			dispose: unsubscribe,
			invalidate: noop,
			render: renderFooterComponent.bind(null, state, footerData, theme),
		};
	};
}
