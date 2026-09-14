import { isRecord } from "../shared/records.ts";
import type {
	JsonValue,
	ModuleStateDescriptor,
} from "../shared/session-state.ts";

export interface HerdrModuleState {
	claimInProgress?: boolean;
	herdrClaimReturnedSuccessfully?: string;
}

function restoreHerdrState(value: unknown): HerdrModuleState {
	const isInvalidRecord = !isRecord(value);
	if (isInvalidRecord) return {};
	const marker = value.herdrClaimReturnedSuccessfully;
	const hasInvalidMarker = marker !== undefined && typeof marker !== "string";
	if (hasInvalidMarker) return {};
	const hasMarker = marker !== undefined;
	return hasMarker ? { herdrClaimReturnedSuccessfully: marker as string } : {};
}

export const herdrStateDescriptor: ModuleStateDescriptor<
	"herdr",
	HerdrModuleState
> = {
	id: "herdr",
	createInitialState: () => ({}),
	restore: restoreHerdrState,
	serialize: (state): JsonValue => {
		const { claimInProgress: _claimInProgress, ...durableState } = state;
		return structuredClone(durableState) as JsonValue;
	},
};
