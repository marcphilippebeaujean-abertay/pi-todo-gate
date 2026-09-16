import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { EXTENSION_CONSTANTS as C } from "../shared/constants.ts";
import { INACTIVE_MESSAGE, NO_PR_MESSAGE, NO_UI_MESSAGE } from "./constants.ts";

export function notifyInactive(context: ExtensionContext): void {
	context.ui.notify(INACTIVE_MESSAGE, C.value.warning);
}

export function notifyNoUi(context: ExtensionContext): void {
	context.ui.notify(NO_UI_MESSAGE, C.value.warning);
}

export function notifyNoPr(context: ExtensionContext): void {
	context.ui.notify(NO_PR_MESSAGE, C.value.warning);
}
