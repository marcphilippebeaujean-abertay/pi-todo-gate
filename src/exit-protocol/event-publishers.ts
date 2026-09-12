import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PromptQueue } from "../shared/prompt-queue.ts";
import type { ExitRequest } from "./state.ts";
import { presentExitActions } from "./user-prompts.ts";

export function enqueueExitActions(
	promptQueue: PromptQueue,
	context: ExtensionContext,
	request: ExitRequest,
	isCurrentContext: () => boolean,
): void {
	void promptQueue
		.enqueue(async (isCurrent) => {
			const hasCurrentContext = isCurrentContext();
			if (!hasCurrentContext) return;
			const hasNoActions = request.actions.length === 0;
			if (hasNoActions) return;
			await presentExitActions(context, request.actions, isCurrent);
		})
		.catch(() => undefined);
}
