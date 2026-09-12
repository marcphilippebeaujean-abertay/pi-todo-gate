import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { EXTENSION_CONSTANTS as C } from "./constants.ts";
import type { ClaimErrorEvent } from "./events.ts";

export type { ClaimErrorEvent, ClaimJobType } from "./events.ts";

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
