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

export function todoistContext(
	state: TodoistState,
	projectRef: string,
): string {
	if (state.taskRef) {
		const details = [state.taskName, state.taskUrl]
			.filter((value): value is string => Boolean(value))
			.join(" — ");
		return [
			`We are tracking tasks with Todoist and you are currently working on task ${state.taskRef}.`,
			"Continue working on and tracking this task in Todoist.",
			details ? `Task details: ${details}` : "",
		]
			.filter(Boolean)
			.join("\n");
	}

	return `# Todoist Task Gate (MANDATORY)

Configured Todoist project: ${projectRef}

Before code changes:
1. Find or create a Todoist task matching this work in the configured project.
2. Assign it through pi_todoist_gate_state using set_task.
3. Do not proceed until task is claimed and tracked.`;
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
