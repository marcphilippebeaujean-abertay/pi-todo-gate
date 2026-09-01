import { labelIsDescriptive } from "./herdr-claim-gate-context.ts";
import type { CommandRunner } from "./herdr-claim-gate-types.ts";
import type { ClaimWorkerResult } from "./herdr-claim-worker-result.ts";

const HERDR_COMMAND = "herdr";
const TAB_GET_ARGS = ["tab", "get"];
const PANE_GET_ARGS = ["pane", "get"];
const STRING_TYPE = "string";

function jsonResult<T>(output: string): T | undefined {
	try {
		return JSON.parse(output) as T;
	} catch {
		return undefined;
	}
}

function tabLabel(
	commandRunner: CommandRunner,
	tabId: string,
): string | undefined {
	const response = jsonResult<{
		result?: { tab?: { label?: unknown } };
	}>(commandRunner(HERDR_COMMAND, [...TAB_GET_ARGS, tabId]));
	const label = response?.result?.tab?.label;
	const hasLabel = typeof label === STRING_TYPE;
	return hasLabel ? (label as string).trim() : undefined;
}

function paneTabId(
	commandRunner: CommandRunner,
	paneId: string,
): string | undefined {
	const response = jsonResult<{
		result?: { pane?: { tab_id?: unknown } };
	}>(commandRunner(HERDR_COMMAND, [...PANE_GET_ARGS, paneId]));
	const tabId = response?.result?.pane?.tab_id;
	const hasTabId = typeof tabId === STRING_TYPE;
	const hasNonEmptyTabId = hasTabId && (tabId as string).length > 0;
	return hasNonEmptyTabId ? (tabId as string) : undefined;
}

export function hasValidatedTabClaim(
	commandRunner: CommandRunner,
	initialLabel: string | undefined,
	paneId: string | undefined,
	claim: ClaimWorkerResult | undefined,
): boolean {
	const hasInitialLabel = initialLabel !== undefined;
	if (!hasInitialLabel) return false;
	const hasPaneId = paneId !== undefined;
	if (!hasPaneId) return false;
	try {
		const observedTabId = paneTabId(commandRunner, paneId);
		const hasObservedTab = observedTabId !== undefined;
		if (!hasObservedTab) return false;
		const currentLabel = tabLabel(commandRunner, observedTabId);
		const hasDescriptiveLabel = labelIsDescriptive(currentLabel);
		const hasChangedLabel = currentLabel !== initialLabel;
		const hasValidObservedClaim = hasDescriptiveLabel && hasChangedLabel;
		if (!hasValidObservedClaim) return false;
		const hasWorkerClaim = claim !== undefined;
		if (!hasWorkerClaim) return true;
		return claim.tabId === observedTabId && claim.label === currentLabel;
	} catch {
		return false;
	}
}
