import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PromptQueue } from "../prompt-queue.ts";
import { EXTENSION_CONSTANTS as C } from "../shared/constants.ts";
import type { EventHandler } from "../shared/events.ts";
import type { ExitAction } from "../shared/exit-actions.ts";
import type { ModuleState } from "../state.ts";
import type { WorktreeModule } from "../worktree/state.ts";
import type { ExitRequest } from "./state.ts";
import { presentExitActions } from "./user-prompts.ts";

export function publishExitProtocolState(
	eventHandler: EventHandler,
	active: boolean,
): Promise<void> {
	const moduleState: ModuleState["exitProtocol"] = { active };
	return eventHandler.moduleStateChangedEvent.emit({
		moduleId: C.module.exitProtocol,
		moduleState,
		persist: false,
	});
}

function addAction(actions: ExitAction[], action: ExitAction): void {
	const alreadyAdded = actions.some((existing) => existing.id === action.id);
	if (!alreadyAdded) actions.push(action);
}

export function createExitRequest(): ExitRequest {
	const actions: ExitAction[] = [];
	return {
		actions,
		addAction: addAction.bind(null, actions),
	};
}

export function addWorktreeExitAction(
	request: ExitRequest,
	worktree: WorktreeModule | undefined,
): void {
	if (worktree === undefined) return;
	const info = worktree.getWorktreeInfo();
	if (info === null) return;
	request.addAction({
		id: "remove-worktree",
		label: `Delete worktree "${info.worktreePath}" and local branch "${info.branch}"`,
		execute: worktree.removeWorktree.bind(worktree),
	});
}

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
