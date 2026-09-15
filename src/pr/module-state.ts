import { isRecord } from "../shared/records.ts";
import type {
	JsonValue,
	ModuleStateDescriptor,
} from "../shared/session-state.ts";

export interface MergedPrState {
	prUrl: string;
	detectedAt: string;
	reminderPending: boolean;
}

export interface PrModuleState {
	prUrl?: string;
	discoveryDisabled: boolean;
	discoveryTestedUrls: string[];
	mergedPrs: MergedPrState[];
}

function normalizeUrl(value: unknown): string | undefined {
	const isValid = typeof value === "string" && value.trim() !== "";
	return isValid ? value : undefined;
}

function testedStrings(values: unknown[]): string[] {
	const result: string[] = [];
	for (const value of values) {
		const url = normalizeUrl(value);
		const isNewUrl = url !== undefined && !result.includes(url);
		if (isNewUrl) result.push(url);
	}
	return result;
}

function isMergedPr(value: unknown): value is MergedPrState {
	const isInvalidRecord = !isRecord(value);
	if (isInvalidRecord) return false;
	const hasUrl = typeof value.prUrl === "string";
	const hasDate = typeof value.detectedAt === "string";
	const hasReminder = typeof value.reminderPending === "boolean";
	const hasValidIdentity = hasUrl && hasDate;
	return hasValidIdentity && hasReminder;
}

export function initialPrState(): PrModuleState {
	return { discoveryDisabled: false, discoveryTestedUrls: [], mergedPrs: [] };
}

export function restorePrState(value: unknown): PrModuleState {
	const isInvalidRecord = !isRecord(value);
	if (isInvalidRecord) return initialPrState();
	const testedUrls = value.discoveryTestedUrls;
	const mergedPrs = value.mergedPrs;
	const hasValidUrl =
		value.prUrl === undefined || typeof value.prUrl === "string";
	const hasValidDiscovery = typeof value.discoveryDisabled === "boolean";
	const hasTestedUrls = Array.isArray(testedUrls);
	const hasValidTestedUrls =
		hasTestedUrls && testedUrls.every((entry) => typeof entry === "string");
	const hasMergedPrs = Array.isArray(mergedPrs);
	const hasValidMergedPrs = hasMergedPrs && mergedPrs.every(isMergedPr);
	const isValid = hasValidUrl && hasValidDiscovery;
	const hasValidArrays = hasValidTestedUrls && hasValidMergedPrs;
	const hasValidState = isValid && hasValidArrays;
	if (!hasValidState) return initialPrState();
	const prUrl = normalizeUrl(value.prUrl);
	return {
		...(prUrl === undefined ? {} : { prUrl }),
		discoveryDisabled: value.discoveryDisabled as boolean,
		discoveryTestedUrls: testedStrings(testedUrls),
		mergedPrs: mergedPrs as MergedPrState[],
	};
}

export function normalizePrState(state: PrModuleState): PrModuleState {
	const prUrl = normalizeUrl(state.prUrl);
	return {
		...(prUrl === undefined ? {} : { prUrl }),
		discoveryDisabled: state.discoveryDisabled,
		discoveryTestedUrls: testedStrings(state.discoveryTestedUrls),
		mergedPrs: state.mergedPrs,
	};
}

export const prStateDescriptor: ModuleStateDescriptor<"pr", PrModuleState> = {
	id: "pr",
	createInitialState: initialPrState,
	restore: restorePrState,
	serialize: (state): JsonValue =>
		structuredClone(normalizePrState(state)) as unknown as JsonValue,
};
