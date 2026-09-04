export interface FooterUpdate {
	footerType: string;
	isLoading: boolean;
	text: string;
	isVisible: boolean;
}

export interface FooterState {
	footers: Record<string, FooterUpdate>;
}

export type FooterEventSink = (event: FooterUpdate) => void;
