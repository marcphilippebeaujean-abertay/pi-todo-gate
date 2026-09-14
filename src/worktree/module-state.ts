import type {
	JsonValue,
	ModuleStateDescriptor,
} from "../shared/session-state.ts";

export interface WorktreeModuleState {
	initialHead?: string;
	initialStatus?: string;
}

function isOptionalString(value: unknown): boolean {
	return value === undefined || typeof value === "string";
}

function restoreWorktreeState(value: unknown): WorktreeModuleState {
	const isObject = typeof value === "object" && value !== null;
	const isInvalid = !isObject || Array.isArray(value);
	if (isInvalid) return {};
	const candidate = value as Record<string, unknown>;
	const hasHead = isOptionalString(candidate.initialHead);
	const hasStatus = isOptionalString(candidate.initialStatus);
	const hasValidState = hasHead && hasStatus;
	if (!hasValidState) return {};
	return {
		...(candidate.initialHead === undefined
			? {}
			: { initialHead: candidate.initialHead as string }),
		...(candidate.initialStatus === undefined
			? {}
			: { initialStatus: candidate.initialStatus as string }),
	};
}

export const worktreeStateDescriptor: ModuleStateDescriptor<
	"worktree",
	WorktreeModuleState
> = {
	id: "worktree",
	createInitialState: () => ({}),
	restore: restoreWorktreeState,
	serialize: (state): JsonValue => structuredClone(state) as JsonValue,
};
