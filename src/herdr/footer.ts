import { HERDR_FOOTER_TYPE } from "../footer/constants.ts";
import type { FooterEventSink } from "../footer/types.ts";

const HERDR_WORKING_STATUS = "Herdr: ⠋ working |";

export function showHerdrFooter(emit: FooterEventSink): void {
	emit({
		footerType: HERDR_FOOTER_TYPE,
		isLoading: true,
		text: HERDR_WORKING_STATUS,
		isVisible: true,
	});
}

export function hideHerdrFooter(emit: FooterEventSink): void {
	emit({
		footerType: HERDR_FOOTER_TYPE,
		isLoading: false,
		text: HERDR_WORKING_STATUS,
		isVisible: false,
	});
}
