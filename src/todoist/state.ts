export const TODOIST_STATE_TYPE = "pi-todoist-gate-state";

export interface TodoistState {
	taskRef?: string;
	taskName?: string;
	taskUrl?: string;
	mergePromptedPrUrl?: string;
}

const STATE_KEYS = new Set<keyof TodoistState>([
	"taskRef",
	"taskName",
	"taskUrl",
	"mergePromptedPrUrl",
]);

export function isTodoistState(value: unknown): value is TodoistState {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		return false;
	const record = value as Record<string, unknown>;
	return Object.entries(record).every(
		([key, item]) =>
			STATE_KEYS.has(key as keyof TodoistState) && typeof item === "string",
	);
}

export function applyTodoistStatePatch(
	state: TodoistState,
	patch: Partial<TodoistState>,
): TodoistState {
	const next = { ...state };
	for (const key of STATE_KEYS) {
		if (!Object.hasOwn(patch, key)) continue;
		const value = patch[key];
		if (value === undefined) delete next[key];
		else next[key] = value;
	}
	return next;
}
