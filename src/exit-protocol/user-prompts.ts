import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { EXIT_NO, EXIT_TITLE, EXIT_YES } from "./constants.ts";
import type { ExitAction, ExitSelection } from "./internal-state.ts";
import { executeExitAction } from "./notifications.ts";

function canPresent(
	context: ExtensionContext | null,
): context is ExtensionContext {
	return Boolean(context?.hasUI);
}

async function pickActions(
	context: ExtensionContext,
	actions: readonly ExitAction[],
): Promise<ExitSelection> {
	const selectedIds: string[] = [];
	for (const action of actions) {
		const defaultAnswer = action.defaultAnswer ?? "yes";
		const isNoDefault = defaultAnswer === "no";
		const options = isNoDefault ? [EXIT_NO, EXIT_YES] : [EXIT_YES, EXIT_NO];
		const answer = await context.ui.select(
			`${EXIT_TITLE}\n${action.label}`,
			options,
		);
		switch (answer) {
			case undefined:
				return null;
			case EXIT_YES:
				selectedIds.push(action.id);
		}
	}
	return selectedIds;
}

function selectedActions(
	actions: readonly ExitAction[],
	selected: ExitSelection,
): readonly ExitAction[] {
	const wasCancelled = selected === null;
	if (wasCancelled) return [];
	const selectedIds = new Set(selected);
	return actions.filter((action) => selectedIds.has(action.id));
}

export async function presentExitActions(
	context: ExtensionContext | null,
	actions: readonly ExitAction[],
	isCurrent?: () => boolean,
): Promise<void> {
	const isCurrentPrompt = isCurrent ?? (() => true);
	const hasContext = canPresent(context);
	const hasActions = actions.length > 0;
	const shouldPresent = hasContext && hasActions;
	if (!shouldPresent) return;
	const selected = await pickActions(context, actions);
	const isCurrentAfterPick = isCurrentPrompt();
	if (!isCurrentAfterPick) return;
	const actionsToExecute = selectedActions(actions, selected);
	for (const action of actionsToExecute) {
		const isCurrentBeforeAction = isCurrentPrompt();
		if (!isCurrentBeforeAction) return;
		await executeExitAction(context, action);
	}
}
