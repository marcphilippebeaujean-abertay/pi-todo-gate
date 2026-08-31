export const PR_STATE_TYPE = "pi-pr-gate-state";

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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMergedPr(value: unknown): value is MergedPr {
	return (
		isRecord(value) &&
		typeof value.prUrl === "string" &&
		typeof value.detectedAt === "string" &&
		typeof value.reminderPending === "boolean"
	);
}

export function isPrState(value: unknown): value is PrState {
	if (!isRecord(value)) return false;
	return (
		(value.prUrl === undefined || typeof value.prUrl === "string") &&
		(value.discoveryDisabled === undefined ||
			typeof value.discoveryDisabled === "boolean") &&
		(value.mergedPrs === undefined ||
			(Array.isArray(value.mergedPrs) && value.mergedPrs.every(isMergedPr)))
	);
}

export function recordMergedPr(state: PrState, detectedAt: string): PrState {
	if (!state.prUrl) return state;
	const mergedPrs = [
		...(state.mergedPrs?.filter((entry) => entry.prUrl !== state.prUrl) ?? []),
		{ prUrl: state.prUrl, detectedAt, reminderPending: true },
	];
	return { mergedPrs, discoveryDisabled: false };
}

export function markRemindersDelivered(state: PrState): PrState {
	if (!state.mergedPrs?.some((entry) => entry.reminderPending)) return state;
	return {
		...state,
		mergedPrs: state.mergedPrs.map((entry) => ({
			...entry,
			reminderPending: false,
		})),
	};
}

export function removeMergedPr(state: PrState, prUrl: string): PrState {
	if (!state.mergedPrs) return state;
	const mergedPrs = state.mergedPrs.filter((entry) => entry.prUrl !== prUrl);
	if (mergedPrs.length === state.mergedPrs.length) return state;
	if (mergedPrs.length === 0) {
		const { mergedPrs: _mergedPrs, ...next } = state;
		return next;
	}
	return { ...state, mergedPrs };
}

export function mergedUrls(state: PrState): string[] {
	return state.mergedPrs?.map((entry) => entry.prUrl) ?? [];
}
