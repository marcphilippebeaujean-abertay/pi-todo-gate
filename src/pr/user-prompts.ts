import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { CONFIRM_MESSAGE, CONFIRM_TITLE_PREFIX } from "./constants.ts";

export function confirmMerge(
	context: ExtensionCommandContext,
	prUrl: string,
): Promise<boolean> {
	return context.ui.confirm(
		`${CONFIRM_TITLE_PREFIX}${prUrl}?`,
		CONFIRM_MESSAGE,
	);
}
