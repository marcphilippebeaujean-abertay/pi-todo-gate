import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { EXTENSION_CONSTANTS as C } from "../constants.ts";
import type { ExitAction } from "./types.ts";

export async function executeExitAction(
	context: ExtensionContext,
	action: ExitAction,
): Promise<void> {
	try {
		await action.execute();
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		try {
			context.ui.notify(`${C.exit.exitActionFailed}${detail}`, C.value.warning);
		} catch {
			// Headless or torn-down UI.
		}
	}
}
