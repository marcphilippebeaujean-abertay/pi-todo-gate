export interface FooterStatusState {
	footerType: string;
	isLoading: boolean;
	text: string;
	isVisible: boolean;
}

export interface FooterModuleState {
	footers: Record<string, FooterStatusState>;
}
