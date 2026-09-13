import {
	HERDR_COMMAND,
	NUMERIC_LABEL,
	PANE_GET_ARGS,
	STRING_TYPE,
	TAB_GET_ARGS,
} from "./constants.ts";
import type { ClaimWorkerResponse, CommandRunner } from "./state.ts";

export function tabNameIsParseableAsInt(label: string | undefined): boolean {
	if (label === undefined) return false;
	const value = label.trim();
	return value.length > 0 && NUMERIC_LABEL.test(value);
}

function labelIsDescriptive(label: string | undefined | null): boolean {
	const hasNoLabel = !label;
	if (hasNoLabel) return false;
	const value = label.trim();
	const hasValue = Boolean(value);
	const isNotNumeric = !tabNameIsParseableAsInt(value);
	return hasValue && isNotNumeric;
}

function matchesWorkerClaim(
	claim: ClaimWorkerResponse | undefined,
	label: string,
	initialLabel: string,
): boolean {
	switch (claim) {
		case undefined:
			return false;
		case null:
			return label === initialLabel;
		default:
			return claim.tabName === label;
	}
}

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
	claim: ClaimWorkerResponse | undefined,
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
		const currentTabLabel = currentLabel ?? "";
		const hasMatchingWorkerClaim = matchesWorkerClaim(
			claim,
			currentTabLabel,
			initialLabel,
		);
		const hasClaimedOrChangedLabel = hasChangedLabel || hasMatchingWorkerClaim;
		const hasValidObservedClaim =
			hasDescriptiveLabel && hasClaimedOrChangedLabel;
		if (!hasValidObservedClaim) return false;
		const hasWorkerClaim = claim !== undefined;
		return !hasWorkerClaim || hasMatchingWorkerClaim;
	} catch {
		return false;
	}
}
