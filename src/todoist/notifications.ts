import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { handleClaimError } from "../claim-error.ts";
import {
	COMPLETION_FAILURE,
	COMPLETION_SUCCESS,
	INFO,
	TODOIST,
	TODOIST_TASK_ASSIGNED,
	WARNING,
} from "./constants.ts";

export function notifyTaskAssigned(context: ExtensionContext): void {
	context.ui.notify(TODOIST_TASK_ASSIGNED, INFO);
}

export function notifyClaimFailure(
	context: ExtensionContext,
	error: string,
): void {
	handleClaimError(context, { jobType: TODOIST, error });
}

export function notifyCompletionSuccess(context: ExtensionContext): void {
	context.ui.notify(COMPLETION_SUCCESS, INFO);
}

export function notifyCompletionFailure(context: ExtensionContext): void {
	context.ui.notify(COMPLETION_FAILURE, WARNING);
}
