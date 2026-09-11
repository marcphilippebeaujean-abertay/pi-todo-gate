import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { INFO } from "./constants.ts";

export function notifyWorktree(
	context: ExtensionContext | null,
	message: string,
	level?: "info" | "warning",
): void {
	const notificationLevel = level ?? INFO;
	try {
		context?.ui.notify(message, notificationLevel);
	} catch {
		// Headless sessions have no user-facing UI.
	}
}
