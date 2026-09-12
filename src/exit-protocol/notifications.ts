import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { EXIT_ACTION_FAILED } from "./constants.ts";
import type { ExitAction } from "./state.ts";

export async function executeExitAction(
	context: ExtensionContext,
	action: ExitAction,
): Promise<void> {
	try {
		await action.execute();
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		try {
			context.ui.notify(`${EXIT_ACTION_FAILED}${detail}`, "warning");
		} catch {
			// Headless or torn-down UI.
		}
	}
}
