import type {
	GitState,
	ModuleId,
	ModuleState,
	ModuleStateDescriptor,
	ModuleStateDescriptors,
	SessionState,
} from "./state.ts";
import { createSessionState } from "./state.ts";

export type {
	JsonValue,
	ModuleStateDescriptor,
	ModuleStateDescriptors,
} from "./state.ts";

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

function isOptionalValue(
	value: unknown,
	type: typeof STRING_TYPE | typeof BOOLEAN_TYPE,
	allowNull?: boolean,
): boolean {
	const isUndefined = value === undefined;
	const permitsNull = allowNull === true;
	const isNull = permitsNull && value === null;
	const hasExpectedType = typeof value === type;
	if (isUndefined) return true;
	if (isNull) return true;
	return hasExpectedType;
}

function isGitState(value: unknown): value is GitState {
	const isGitRecord = isRecord(value);
	if (!isGitRecord) return false;
	const validityChecks = [
		isOptionalValue(value.remoteOrigin, STRING_TYPE),
		isOptionalValue(value.mergeCompletedAt, STRING_TYPE),
		isOptionalValue(value.branch, STRING_TYPE, true),
		isOptionalValue(value.isWorktree, BOOLEAN_TYPE),
		isOptionalValue(value.worktreeRoot, STRING_TYPE, true),
		isOptionalValue(value.mainRoot, STRING_TYPE, true),
		isOptionalValue(value.hasUncommittedChanges, BOOLEAN_TYPE),
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
	const hasValidSession = isOptionalValue(
		session.inheritedFromSessionId,
		STRING_TYPE,
	);
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

function serializeModuleState(
	state: SessionState,
	descriptors: ModuleStateDescriptors,
): PersistedSessionState["moduleState"] {
	return {
		pr: descriptors.pr.serialize(
			state.moduleState.pr,
		) as unknown as ModuleState["pr"],
		todoist: descriptors.todoist.serialize(
			state.moduleState.todoist,
		) as unknown as ModuleState["todoist"],
		herdr: descriptors.herdr.serialize(
			state.moduleState.herdr,
		) as unknown as ModuleState["herdr"],
		worktree: descriptors.worktree.serialize(
			state.moduleState.worktree,
		) as unknown as ModuleState["worktree"],
		footer: descriptors.footer.serialize(
			state.moduleState.footer,
		) as unknown as ModuleState["footer"],
		exitProtocol: descriptors.exitProtocol.serialize(
			state.moduleState.exitProtocol,
		) as unknown as ModuleState["exitProtocol"],
	};
}

function restoreModuleState(
	value: PersistedSessionState["moduleState"],
	descriptors: ModuleStateDescriptors,
): ModuleState {
	return {
		pr: descriptorState(descriptors.pr, value.pr),
		todoist: descriptorState(descriptors.todoist, value.todoist),
		herdr: descriptorState(descriptors.herdr, value.herdr),
		worktree: descriptorState(descriptors.worktree, value.worktree),
		footer: descriptorState(descriptors.footer, value.footer),
		exitProtocol: descriptorState(descriptors.exitProtocol, value.exitProtocol),
	};
}

export function serializeSessionState(
	state: SessionState,
	descriptors: ModuleStateDescriptors,
): PersistedSessionState {
	return {
		schemaVersion: CURRENT_SCHEMA_VERSION,
		session: {
			...(state.session.inheritedFromSessionId === undefined
				? {}
				: { inheritedFromSessionId: state.session.inheritedFromSessionId }),
		},
		gitState: structuredClone(state.gitState),
		moduleState: serializeModuleState(state, descriptors),
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
	restored.moduleState = restoreModuleState(value.moduleState, descriptors);
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
