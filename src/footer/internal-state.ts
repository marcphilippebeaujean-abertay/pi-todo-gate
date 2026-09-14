import type { EventHandler } from "../shared/events.ts";
import type { SessionState } from "../state.ts";
import type { FooterUpdate } from "./module-state.ts";

export interface FooterModuleOptions {
	eventHandler: EventHandler;
	sessionState: SessionState;
}
export type FooterSessionRecord = {
	ui: {
		setStatus(key: string, text: string | undefined): void;
	};
};
export type AnimationTimer = ReturnType<typeof setInterval>;
export interface FooterAnimation {
	timer: AnimationTimer | null;
	event: FooterUpdate;
	frameIndex: number;
}
export interface FooterRenderState {
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
export interface TodoistFooterTheme {
	fg(color: string, text: string): string;
}

export interface FooterEntry {
	readonly isVisible: boolean;
	update(event: FooterUpdate): void;
	render(): string;
}
