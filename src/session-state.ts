const CUSTOM = "custom";
const PI_TODO_GATE_STATE = "pi-todo-gate-state";
const OBJECT_TYPE = "object";
const STRING_TYPE = "string";

import type { WorkState } from "./types.ts";

const STATE_KEYS: readonly (keyof WorkState)[] = [
	"prUrl",
	"taskUrl",
	"taskRef",
	"taskName",
	"inheritedFrom",
	"mergeCompletedAt",
	"todoistCompletionAttemptedAt",
];

function isRecord(value: unknown): value is Record<string, unknown> {
	const isObjectValue = typeof value === OBJECT_TYPE;
	const isNullValue = value === null;
	const isNotObject = !isObjectValue || isNullValue;
	if (isNotObject) return false;
	return !Array.isArray(value);
}

export function isWorkState(value: unknown): value is WorkState {
	const record = isRecord(value) ? value : null;
	if (record === null) return false;
	return STATE_KEYS.every(
		(key) => record[key] === undefined || typeof record[key] === STRING_TYPE,
	);
}

function stateFromEntry(entry: unknown): WorkState | null {
	const record = isRecord(entry) ? entry : null;
	if (record === null) return null;
	const isCustomEntry = record.type === CUSTOM;
	if (!isCustomEntry) return null;
	const isStateEntry = record.customType === PI_TODO_GATE_STATE;
	if (!isStateEntry) return null;
	return isWorkState(record.data) ? { ...record.data } : null;
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
		const isMissingPatchKey: boolean = !Object.hasOwn(patch, key);
		if (isMissingPatchKey) continue;
		const value = patch[key];
		if (value === undefined) delete next[key];
		else next[key] = value;
	}
	return next;
}

export function latestState(entries: readonly unknown[]): WorkState {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const state = stateFromEntry(entries[index]);
		if (state === null) continue;
		return state;
	}
	return emptyWorkState();
}

export function extractInheritedState(
	entries: readonly unknown[],
): WorkState | null {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const state = stateFromEntry(entries[index]);
		if (state === null) continue;
		return state;
	}
	return null;
}
