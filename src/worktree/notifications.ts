import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { EXTENSION_CONSTANTS as C } from "../constants.ts";

export function notifyWorktree(
	context: ExtensionContext | null,
	message: string,
	level: "info" | "warning" = C.value.info,
): void {
	try {
		context?.ui.notify(message, level);
	} catch {
		// Headless sessions have no user-facing UI.
	}
}
