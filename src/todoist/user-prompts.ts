import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { COMPLETE_LABEL_PREFIX, COMPLETE_LABEL_SUFFIX } from "./constants.ts";

export function taskPrompt(taskName: string): string {
	return `${COMPLETE_LABEL_PREFIX}${taskName}${COMPLETE_LABEL_SUFFIX}`;
}

export function confirmTaskCompletion(
	context: ExtensionContext,
	taskName: string,
	taskRef: string,
): Promise<boolean> {
	return context.ui.confirm(taskPrompt(taskName), `Todoist task ${taskRef}`);
}
