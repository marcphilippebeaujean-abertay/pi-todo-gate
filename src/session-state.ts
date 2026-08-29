import type { WorkState } from "./types.ts";

const STATE_KEYS: readonly (keyof WorkState)[] = [
	"prUrl",
	"taskUrl",
	"taskRef",
	"inheritedFrom",
	"mergeCompletedAt",
	"todoistCompletionAttemptedAt",
];

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isWorkState(value: unknown): value is WorkState {
	if (!isRecord(value)) return false;
	return STATE_KEYS.every(
		(key) => value[key] === undefined || typeof value[key] === "string",
	);
}

function stateFromEntry(entry: unknown): WorkState | null {
	if (
		!isRecord(entry) ||
		entry.type !== "custom" ||
		entry.customType !== "pi-todo-gate-state"
	)
		return null;
	return isWorkState(entry.data) ? { ...entry.data } : null;
}

export function emptyWorkState(): WorkState {
	return {};
}

export function applyStatePatch(
	state: WorkState,
	patch: Partial<WorkState>,
): WorkState {
	const next: WorkState = { ...state };
	for (const key of STATE_KEYS) {
		if (!Object.hasOwn(patch, key)) continue;
		const value = patch[key];
		if (value === undefined) delete next[key];
		else next[key] = value;
	}
	return next;
}

export function latestState(entries: readonly unknown[]): WorkState {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const state = stateFromEntry(entries[index]);
		if (state) return state;
	}
	return emptyWorkState();
}

export function extractInheritedState(
	entries: readonly unknown[],
): WorkState | null {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const state = stateFromEntry(entries[index]);
		if (state) return state;
	}
	return null;
}
