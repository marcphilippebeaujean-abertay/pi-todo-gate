export interface FooterType {
	id: string;
	name: string;
}

export interface FooterUpdateEvent {
	footerType: FooterType;
	isLoading: boolean;
	currentValue: string;
	isVisible: boolean;
}

export interface FooterSessionStartEvent {
	previousSessionFile?: string;
}
