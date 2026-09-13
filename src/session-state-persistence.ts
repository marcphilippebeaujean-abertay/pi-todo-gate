import type {
	GitState,
	ModuleId,
	ModuleState,
	ModuleStateDescriptor,
	ModuleStateDescriptors,
	SessionState,
} from "./shared/session-state.ts";
import { createSessionState } from "./state.ts";

export type {
	JsonValue,
	ModuleStateDescriptor,
	ModuleStateDescriptors,
} from "./shared/session-state.ts";

const CUSTOM_ENTRY_TYPE = "custom";
const STATE_CUSTOM_TYPE = "pi-todo-gate-state";
const CURRENT_SCHEMA_VERSION = 1;
const OBJECT_TYPE = "object";
const STRING_TYPE = "string";
const BOOLEAN_TYPE = "boolean";

export interface PersistedSessionState {
	schemaVersion: 1;
	session: {
		inheritedFromSessionId?: string;
	};
	gitState: GitState;
	moduleState: ModuleState;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	const isObject = typeof value === OBJECT_TYPE && value !== null;
	const isArray = Array.isArray(value);
	return isObject && !isArray;
}

function isOptionalString(value: unknown): boolean {
	return value === undefined || typeof value === STRING_TYPE;
}

function isOptionalNullableString(value: unknown): boolean {
	switch (value) {
		case undefined:
		case null:
			return true;
		default:
			return typeof value === STRING_TYPE;
	}
}

function isOptionalBoolean(value: unknown): boolean {
	return value === undefined || typeof value === BOOLEAN_TYPE;
}

function isGitState(value: unknown): value is GitState {
	const isGitRecord = isRecord(value);
	if (!isGitRecord) return false;
	const validityChecks = [
		isOptionalString(value.remoteOrigin),
		isOptionalString(value.mergeCompletedAt),
		isOptionalNullableString(value.branch),
		isOptionalBoolean(value.isWorktree),
		isOptionalNullableString(value.worktreeRoot),
		isOptionalNullableString(value.mainRoot),
		isOptionalBoolean(value.hasUncommittedChanges),
	];
	return validityChecks.every(Boolean);
}

function isPersistedSessionState(
	value: unknown,
): value is PersistedSessionState {
	const isPersistedRecord = isRecord(value);
	if (!isPersistedRecord) return false;
	const hasCurrentSchema = value.schemaVersion === CURRENT_SCHEMA_VERSION;
	if (!hasCurrentSchema) return false;
	const session = value.session;
	const isSessionRecord = isRecord(session);
	if (!isSessionRecord) return false;
	const hasValidSession = isOptionalString(session.inheritedFromSessionId);
	if (!hasValidSession) return false;
	const hasValidGitState = isGitState(value.gitState);
	if (!hasValidGitState) return false;
	const hasModuleState = isRecord(value.moduleState);
	return hasModuleState;
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
	const hasPersistedState = isPersistedSessionState(value);
	if (!hasPersistedState) return restored;

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
		const isRecordEntry = isRecord(entry);
		if (!isRecordEntry) continue;
		const hasCustomType = entry.type === CUSTOM_ENTRY_TYPE;
		if (!hasCustomType) continue;
		const hasStateType = entry.customType === STATE_CUSTOM_TYPE;
		if (!hasStateType) continue;
		const hasValidState = isPersistedSessionState(entry.data);
		if (!hasValidState) continue;
		return structuredClone(entry.data as PersistedSessionState);
	}
	return null;
}
