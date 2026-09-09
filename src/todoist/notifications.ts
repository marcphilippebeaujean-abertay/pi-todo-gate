import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { handleClaimError } from "../claim-error.ts";
import { EXTENSION_CONSTANTS as C } from "../constants.ts";

export function notifyTaskAssigned(context: ExtensionContext): void {
	context.ui.notify("Todoist task assigned", C.value.info);
}

export function notifyClaimFailure(
	context: ExtensionContext,
	error: string,
): void {
	handleClaimError(context, { jobType: "Todoist", error });
}

export function notifyCompletionSuccess(context: ExtensionContext): void {
	context.ui.notify(C.message.merged, C.value.info);
}

export function notifyCompletionFailure(context: ExtensionContext): void {
	context.ui.notify(C.message.mergedFailed, C.value.warning);
}
