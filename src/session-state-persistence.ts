import type { GitState, ModuleId, ModuleState, SessionState } from "./state.ts";
import { createSessionState } from "./state.ts";

const CUSTOM_ENTRY_TYPE = "custom";
const STATE_CUSTOM_TYPE = "pi-todo-gate-state";
const CURRENT_SCHEMA_VERSION = 1;
const OBJECT_TYPE = "object";
const STRING_TYPE = "string";
const BOOLEAN_TYPE = "boolean";

export type JsonValue =
	| string
	| number
	| boolean
	| null
	| JsonValue[]
	| { [key: string]: JsonValue | undefined };

export interface PersistedSessionState {
	schemaVersion: 1;
	session: {
		inheritedFromSessionId?: string;
	};
	gitState: GitState;
	moduleState: ModuleState;
}

export interface ModuleStateDescriptor<K extends ModuleId> {
	id: K;
	createInitialState(): ModuleState[K];
	restore(value: unknown): ModuleState[K];
	serialize(state: ModuleState[K]): JsonValue;
}

export type ModuleStateDescriptors = {
	[K in ModuleId]: ModuleStateDescriptor<K>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	const isObject = typeof value === OBJECT_TYPE;
	return isObject && value !== null && !Array.isArray(value);
}

function isOptionalString(value: unknown): boolean {
	return value === undefined || typeof value === STRING_TYPE;
}

function isOptionalNullableString(value: unknown): boolean {
	return value === undefined || value === null || typeof value === STRING_TYPE;
}

function isOptionalBoolean(value: unknown): boolean {
	return value === undefined || typeof value === BOOLEAN_TYPE;
}

function isGitState(value: unknown): value is GitState {
	if (!isRecord(value)) return false;
	return (
		isOptionalString(value.remoteOrigin) &&
		isOptionalString(value.mergeCompletedAt) &&
		isOptionalNullableString(value.branch) &&
		isOptionalBoolean(value.isWorktree) &&
		isOptionalNullableString(value.worktreeRoot) &&
		isOptionalNullableString(value.mainRoot) &&
		isOptionalBoolean(value.hasUncommittedChanges)
	);
}

function isPersistedSessionState(
	value: unknown,
): value is PersistedSessionState {
	if (!isRecord(value)) return false;
	if (value.schemaVersion !== CURRENT_SCHEMA_VERSION) return false;
	const session = value.session;
	if (!isRecord(session) || !isOptionalString(session.inheritedFromSessionId))
		return false;
	if (!isGitState(value.gitState)) return false;
	return isRecord(value.moduleState);
}

function descriptorState<K extends ModuleId>(
	descriptor: ModuleStateDescriptor<K>,
	value: unknown,
): ModuleState[K] {
	try {
		return descriptor.restore(value);
	} catch {
		return descriptor.createInitialState();
	}
}

export function serializeSessionState(
	state: SessionState,
	descriptors: ModuleStateDescriptors,
): PersistedSessionState {
	const moduleState = {} as ModuleState;
	for (const moduleId of Object.keys(state.moduleState) as ModuleId[]) {
		const descriptor = descriptors[moduleId] as ModuleStateDescriptor<
			typeof moduleId
		>;
		const serialized = descriptor.serialize(
			state.moduleState[moduleId] as never,
		);
		moduleState[moduleId] = serialized as never;
	}
	return {
		schemaVersion: CURRENT_SCHEMA_VERSION,
		session: {
			...(state.session.inheritedFromSessionId === undefined
				? {}
				: { inheritedFromSessionId: state.session.inheritedFromSessionId }),
		},
		gitState: structuredClone(state.gitState),
		moduleState,
	};
}

export function restoreSessionState(
	value: unknown,
	descriptors: ModuleStateDescriptors,
): SessionState {
	const restored = createSessionState();
	if (!isPersistedSessionState(value)) return restored;

	restored.session.inheritedFromSessionId =
		value.session.inheritedFromSessionId;
	restored.gitState = structuredClone(value.gitState);
	for (const moduleId of Object.keys(restored.moduleState) as ModuleId[]) {
		const descriptor = descriptors[moduleId] as ModuleStateDescriptor<
			typeof moduleId
		>;
		restored.moduleState[moduleId] = descriptorState(
			descriptor,
			value.moduleState[moduleId],
		) as never;
	}
	return restored;
}

export function latestPersistedSessionState(
	entries: readonly unknown[],
): PersistedSessionState | null {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (!isRecord(entry)) continue;
		if (entry.type !== CUSTOM_ENTRY_TYPE) continue;
		if (entry.customType !== STATE_CUSTOM_TYPE) continue;
		if (!isPersistedSessionState(entry.data)) continue;
		return structuredClone(entry.data);
	}
	return null;
}
