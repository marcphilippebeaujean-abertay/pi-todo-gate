export interface FooterUpdateEvent {
	footerType: string;
	isLoading: boolean;
	text: string;
	isVisible: boolean;
}

export interface FooterSessionStartEvent {
	previousSessionFile?: string;
}

export type FooterEventSink = (event: FooterUpdateEvent) => void;
