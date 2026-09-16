import { isRecord } from "../shared/records.ts";
import type {
	JsonValue,
	ModuleStateDescriptor,
} from "../shared/session-state.ts";

export interface TodoistModuleState {
	taskRef?: string;
	taskName?: string;
	taskDescription?: string;
	taskUrl?: string;
	todoistCompletionAttemptedAt?: string;
	mergePromptedPrUrl?: string;
}

function restoreTodoistState(value: unknown): TodoistModuleState {
	const isInvalidRecord = !isRecord(value);
	if (isInvalidRecord) return {};
	const keys = [
		"taskRef",
		"taskName",
		"taskDescription",
		"taskUrl",
		"todoistCompletionAttemptedAt",
		"mergePromptedPrUrl",
	] as const;
	const isValid = keys.every(
		(key) => value[key] === undefined || typeof value[key] === "string",
	);
	if (!isValid) return {};
	return Object.fromEntries(
		keys.flatMap((key) =>
			value[key] === undefined ? [] : [[key, value[key] as string]],
		),
	) as TodoistModuleState;
}

export const todoistStateDescriptor: ModuleStateDescriptor<
	"todoist",
	TodoistModuleState
> = {
	id: "todoist",
	createInitialState: () => ({}),
	restore: restoreTodoistState,
	serialize: (state): JsonValue => structuredClone(state) as JsonValue,
};
