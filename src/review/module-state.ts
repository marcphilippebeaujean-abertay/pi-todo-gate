import type {
	JsonValue,
	ModuleStateDescriptor,
} from "../shared/session-state.ts";

export interface ReviewModuleState {
	reserved?: null;
}

export const reviewStateDescriptor: ModuleStateDescriptor<
	"review",
	ReviewModuleState
> = {
	id: "review",
	createInitialState: () => ({}),
	restore: () => ({}),
	serialize: (): JsonValue => ({}),
};
