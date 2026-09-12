import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { EXTENSION_CONSTANTS as C } from "../constants.ts";
import {
	INACTIVE_MESSAGE,
	MERGE_FAILED_PREFIX,
	MERGE_SUCCEEDED,
	NO_PR_MESSAGE,
	NO_UI_MESSAGE,
} from "./constants.ts";

export function notifyInactive(context: ExtensionCommandContext): void {
	context.ui.notify(INACTIVE_MESSAGE, C.value.warning);
}
export function notifyNoUi(context: ExtensionCommandContext): void {
	context.ui.notify(NO_UI_MESSAGE, C.value.warning);
}
export function notifyNoPr(context: ExtensionCommandContext): void {
	context.ui.notify(NO_PR_MESSAGE, C.value.warning);
}
export function notifyMergeFailure(
	context: ExtensionCommandContext,
	detail: string,
): void {
	const hasDetail = detail !== "";
	const suffix = hasDetail ? `: ${detail}` : "";
	context.ui.notify(`${MERGE_FAILED_PREFIX}${suffix}`, C.value.warning);
}
export function notifyMergeSucceeded(context: ExtensionCommandContext): void {
	context.ui.notify(MERGE_SUCCEEDED, C.value.info);
}
