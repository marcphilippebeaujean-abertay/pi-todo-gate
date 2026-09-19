import { isRecord } from "../shared/records.ts";
import type {
	JsonValue,
	ModuleStateDescriptor,
} from "../shared/session-state.ts";

export interface HerdrTabRenameModuleState {
	herdrClaimReturnedSuccessfully?: string;
}

function restoreHerdrState(value: unknown): HerdrTabRenameModuleState {
	const isInvalidRecord = !isRecord(value);
	if (isInvalidRecord) return {};
	const marker = value.herdrClaimReturnedSuccessfully;
	const hasInvalidMarker = marker !== undefined && typeof marker !== "string";
	if (hasInvalidMarker) return {};
	const hasMarker = marker !== undefined;
	return hasMarker ? { herdrClaimReturnedSuccessfully: marker as string } : {};
}

export const herdrTabRenameStateDescriptor: ModuleStateDescriptor<
	"herdrTabRename",
	HerdrTabRenameModuleState
> = {
	id: "herdrTabRename",
	createInitialState: () => ({}),
	restore: restoreHerdrState,
	serialize: (state): JsonValue => structuredClone(state) as JsonValue,
};
