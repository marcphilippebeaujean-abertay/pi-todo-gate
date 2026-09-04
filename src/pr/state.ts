export const PR_STATE_TYPE = "pi-pr-gate-state";
const STRING_LITERAL_STRING = "string";
const STRING_LITERAL_BOOLEAN = "boolean";

import { isRecord } from "../shared/records.ts";

export interface MergedPr {
	prUrl: string;
	detectedAt: string;
	reminderPending: boolean;
}

export interface PrState {
	prUrl?: string;
	mergedPrs?: MergedPr[];
	discoveryDisabled?: boolean;
}

function withoutPrUrl(entries: MergedPr[], prUrl: string): MergedPr[] {
	const result: MergedPr[] = [];
	for (const entry of entries) {
		const isSamePrUrl = entry.prUrl === prUrl;
		if (isSamePrUrl) continue;
		result.push(entry);
	}
	return result;
}

function hasPendingReminder(entry: MergedPr): boolean {
	return entry.reminderPending;
}

function clearReminder(entry: MergedPr): MergedPr {
	return { ...entry, reminderPending: false };
}

function prUrlOf(entry: MergedPr): string {
	return entry.prUrl;
}

function isMergedPr(value: unknown): value is MergedPr {
	const isRecordValue = isRecord(value);
	const record = isRecordValue ? value : null;
	if (record === null) return false;
	const hasPrUrl = typeof record.prUrl === STRING_LITERAL_STRING;
	if (!hasPrUrl) return false;
	const hasDetectedAt = typeof record.detectedAt === STRING_LITERAL_STRING;
	if (!hasDetectedAt) return false;
	return typeof record.reminderPending === STRING_LITERAL_BOOLEAN;
}

export function isPrState(value: unknown): value is PrState {
	const isRecordValue = isRecord(value);
	const record = isRecordValue ? value : null;
	if (record === null) return false;
	const hasValidPrUrl =
		record.prUrl === undefined || typeof record.prUrl === STRING_LITERAL_STRING;
	if (!hasValidPrUrl) return false;
	const hasValidDiscoveryDisabled =
		record.discoveryDisabled === undefined ||
		typeof record.discoveryDisabled === STRING_LITERAL_BOOLEAN;
	if (!hasValidDiscoveryDisabled) return false;
	if (record.mergedPrs === undefined) return true;
	if (!Array.isArray(record.mergedPrs)) return false;
	return record.mergedPrs.every(isMergedPr);
}

export function recordMergedPr(state: PrState, detectedAt: string): PrState {
	const prUrl = state.prUrl;
	if (prUrl === undefined) return state;
	const hasPrUrl = prUrl !== "";
	if (!hasPrUrl) return state;
	const existingMergedPrs = state.mergedPrs ?? [];
	const mergedPrs = [
		...withoutPrUrl(existingMergedPrs, prUrl),
		{ prUrl, detectedAt, reminderPending: true },
	];
	return { mergedPrs, discoveryDisabled: false };
}

export function markRemindersDelivered(state: PrState): PrState {
	const existingMergedPrs = state.mergedPrs;
	if (existingMergedPrs === undefined) return state;
	const hasPending = existingMergedPrs.some(hasPendingReminder);
	if (!hasPending) return state;
	return {
		...state,
		mergedPrs: existingMergedPrs.map(clearReminder),
	};
}

export function removeMergedPr(state: PrState, prUrl: string): PrState {
	const existingMergedPrs = state.mergedPrs;
	if (existingMergedPrs === undefined) return state;
	const mergedPrs = withoutPrUrl(existingMergedPrs, prUrl);
	const hasSameLength = mergedPrs.length === existingMergedPrs.length;
	if (hasSameLength) return state;
	const hasNoMergedPrs = mergedPrs.length === 0;
	if (hasNoMergedPrs) {
		const { mergedPrs: _mergedPrs, ...next } = state;
		return next;
	}
	return { ...state, mergedPrs };
}

export function mergedUrls(state: PrState): string[] {
	return state.mergedPrs?.map(prUrlOf) ?? [];
}
