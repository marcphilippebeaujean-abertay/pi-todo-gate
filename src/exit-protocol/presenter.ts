import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { EXTENSION_CONSTANTS as C } from "../constants.ts";
import { pickWithCustomUI } from "./custom-picker.ts";
import { executeExitAction } from "./executor.ts";
import type { ExitPickerResult } from "./picker.ts";
import type { ExitAction } from "./types.ts";

function canPresent(
	context: ExtensionContext | null,
): context is ExtensionContext {
	return Boolean(context?.hasUI);
}

async function pickActions(
	context: ExtensionContext,
	actions: readonly ExitAction[],
): Promise<ExitPickerResult> {
	const custom = context.ui.custom;
	const isTuiMode = context.mode === C.value.tui;
	const hasCustomPicker = typeof custom === "function";
	const canUseCustomPicker = isTuiMode && hasCustomPicker;
	if (canUseCustomPicker) return pickWithCustomUI(custom, actions);
	const selectedIds: string[] = [];
	for (const action of actions) {
		const confirmed = await context.ui.confirm(C.exit.title, action.label);
		if (confirmed) selectedIds.push(action.id);
	}
	return selectedIds;
}

function selectedActions(
	actions: readonly ExitAction[],
	selected: ExitPickerResult,
): readonly ExitAction[] {
	const wasCancelled = selected === null;
	if (wasCancelled) return [];
	const selectedIds = new Set(selected);
	return actions.filter((action) => selectedIds.has(action.id));
}

export async function presentExitActions(
	context: ExtensionContext | null,
	actions: readonly ExitAction[],
): Promise<void> {
	const hasContext = canPresent(context);
	const hasActions = actions.length > 0;
	const shouldPresent = hasContext && hasActions;
	if (!shouldPresent) return;
	const selected = await pickActions(context, actions);
	const actionsToExecute = selectedActions(actions, selected);
	for (const action of actionsToExecute)
		await executeExitAction(context, action);
}
