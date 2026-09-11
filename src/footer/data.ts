import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";

export interface FooterUpdate {
	footerType: string;
	isLoading: boolean;
	text: string;
	isVisible: boolean;
}

export interface FooterState {
	footers: Record<string, FooterUpdate>;
}

export interface PersistedFooterUpdate {
	footerType: string;
	isLoading?: boolean;
	text: string | null;
}

export interface PersistedFooterState {
	footers: Record<string, PersistedFooterUpdate>;
}

export type FooterEventSink = (event: FooterUpdate) => void;
export interface FooterSessionReader {
	getBranch(): unknown[];
}
export interface FooterModuleDependencies {
	openSession?: (path: string) => FooterSessionReader;
}
export interface FooterModule {
	sessionStart(
		event: { previousSessionFile?: string },
		ctx: ExtensionContext,
	): Promise<void>;
	update(event: FooterUpdate): void;
	getState(): FooterState;
	deactivate(): void;
}
export type FooterModuleFactory = (
	pi: ExtensionAPI,
	dependencies?: FooterModuleDependencies,
) => FooterModule;

export type FooterSessionContext = {
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
