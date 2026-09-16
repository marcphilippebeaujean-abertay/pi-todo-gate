import { EXTENSION_CONSTANTS as C } from "../shared/constants.ts";
import { MERGE_FAILED_PREFIX, MERGE_SUCCEEDED } from "./constants.ts";
import type { NotificationContext } from "./internal-state.ts";

export function notifyMergeFailure(
	context: NotificationContext,
	detail: string,
): void {
	const hasDetail = detail !== "";
	const suffix = hasDetail ? `: ${detail}` : "";
	context.ui.notify(`${MERGE_FAILED_PREFIX}${suffix}`, C.value.warning);
}
export function notifyMergeSucceeded(context: NotificationContext): void {
	context.ui.notify(MERGE_SUCCEEDED, C.value.info);
}
