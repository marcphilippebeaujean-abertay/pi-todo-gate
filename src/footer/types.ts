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
