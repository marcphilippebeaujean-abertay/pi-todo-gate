import { publishSessionNotification } from "../event-publishers.ts";
import { EXTENSION_CONSTANTS as C } from "../shared/constants.ts";
import type { EventHandler } from "../shared/events.ts";

export function notifyHerdrFailure(
	eventHandler: EventHandler,
	error: string,
): Promise<void> {
	return publishSessionNotification(
		eventHandler,
		`Warning: Herdr claim worker completed without claim evidence/ran into an error (${error})`,
		C.value.warning,
	);
}
