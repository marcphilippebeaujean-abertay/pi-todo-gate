import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { handleClaimError } from "../claim-error.ts";
import { HERDR, HERDR_FOOTER_TYPE, HERDR_WORKING_STATUS } from "./constants.ts";
import type { FooterEventSink } from "./events.ts";

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

export function notifyHerdrFailure(
	context: ExtensionContext,
	error: string,
): void {
	handleClaimError(context, { jobType: HERDR, error });
}
