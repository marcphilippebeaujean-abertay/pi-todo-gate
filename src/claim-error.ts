import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { EXTENSION_CONSTANTS as C } from "./constants.ts";

export type ClaimJobType = "Herdr" | "Todoist";

export interface ClaimErrorEvent {
	jobType: ClaimJobType;
	error: string;
}

export function handleClaimError(
	context: Pick<ExtensionContext, "ui">,
	event: ClaimErrorEvent,
): void {
	try {
		context.ui.notify(
			`Warning: ${event.jobType} claim worker completed without claim evidence/ran into an error (${event.error})`,
			C.value.warning,
		);
	} catch {
		// Headless sessions have no user-facing UI.
	}
}
