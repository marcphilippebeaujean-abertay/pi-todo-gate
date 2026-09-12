export interface FooterUpdate {
	footerType: string;
	isLoading: boolean;
	text: string;
	isVisible: boolean;
}

export type FooterEventSink = (event: FooterUpdate) => void;

export interface FooterSessionStartEvent {
	previousSessionFile?: string;
}
