import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { EXTENSION_CONSTANTS as C } from "../constants.ts";

export function taskPrompt(taskName: string): string {
	return `${C.todoist.completeLabelPrefix}${taskName}${C.todoist.completeLabelSuffix}?`;
}

export function confirmTaskCompletion(
	context: ExtensionContext,
	taskName: string,
	taskRef: string,
): Promise<boolean> {
	return context.ui.confirm(taskPrompt(taskName), `Todoist task ${taskRef}`);
}
