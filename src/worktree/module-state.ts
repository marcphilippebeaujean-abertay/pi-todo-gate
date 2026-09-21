import type {
	JsonValue,
	ModuleStateDescriptor,
} from "../shared/session-state.ts";

// biome-ignore lint/suspicious/noEmptyInterface: marker type for empty module state
export interface WorktreeModuleState {}

export const worktreeStateDescriptor: ModuleStateDescriptor<
	"worktree",
	WorktreeModuleState
> = {
	id: "worktree",
	createInitialState: () => ({}),
	restore: () => ({}),
	serialize: (_state): JsonValue => ({}),
};
