import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { ExitProtocolModule } from "./exit-protocol/state.ts";
import type { FooterModule } from "./footer/state.ts";
import type {
	CommandRunner as HerdrCommandRunner,
	StartBackgroundWorker,
} from "./herdr/state.ts";
import type { PrModule } from "./pr/state.ts";
import type { PromptQueue } from "./prompt-queue.ts";
import type { Exec } from "./shared/command.ts";
import type { EventHandler } from "./shared/events.ts";
import type {
	GitState,
	SessionReader,
	WorkState,
} from "./shared/session-state.ts";

export type {
	SessionReader,
	SessionRecord,
	SessionStateSnapshot,
	WorkState,
} from "./shared/session-state.ts";

import type {
	TaskClaimWorker,
	TodoistClientLike,
	TodoistModule,
	TodoistProjectMapping,
} from "./todoist/state.ts";
import type { WorktreeModule } from "./worktree/state.ts";

export type ModuleState = Record<string, unknown>;

export interface SessionState {
	sessionId: string | null;
	gitState: GitState;
	moduleState: Record<string, unknown>;
}

export function createSessionState(): SessionState {
	return { sessionId: null, gitState: {}, moduleState: {} };
}

const CUSTOM = "custom";
const PI_TODO_GATE_STATE = "pi-todo-gate-state";
const OBJECT_TYPE = "object";
const STRING_TYPE = "string";

const STATE_KEYS: readonly (keyof WorkState)[] = [
	"remoteOrigin",
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
	const isRecordValue = isRecord(value);
	const record = isRecordValue ? value : null;
	if (record === null) return false;
	return STATE_KEYS.every(
		(key) => record[key] === undefined || typeof record[key] === STRING_TYPE,
	);
}

function stateFromEntry(entry: unknown): WorkState | null {
	const isRecordEntry = isRecord(entry);
	const record = isRecordEntry ? entry : null;
	if (record === null) return null;
	const isCustomEntry = record.type === CUSTOM;
	if (!isCustomEntry) return null;
	const isStateEntry = record.customType === PI_TODO_GATE_STATE;
	if (!isStateEntry) return null;
	const hasValidState = isWorkState(record.data);
	return hasValidState ? { ...(record.data as WorkState) } : null;
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

export type WorkStateAction =
	| { action: "status" }
	| { action: "set_pr"; url: string }
	| { action: "clear_pr" }
	| { action: "clear_all" };

export type StateToolParams =
	| { action: "status"; url?: string }
	| { action: "set_pr"; url?: string }
	| { action: "clear_pr"; url?: string }
	| { action: "clear_all"; url?: string };

export interface ExtensionDependencies {
	loadConfig?: (path?: string) => Promise<TodoistProjectMapping>;
	openSession?: (path: string) => SessionReader;
	exec?: Exec;
	createTodoistClient?: (
		ctx: ExtensionContext,
		exec: Exec,
	) => TodoistClientLike;
	taskClaimWorker?: TaskClaimWorker;
	herdrCommandRunner?: HerdrCommandRunner;
	herdrStartBackgroundWorker?: StartBackgroundWorker;
}

export interface ExtensionState {
	pi: ExtensionAPI;
	dependencies: ExtensionDependencies;
	sessionState: SessionState;
	promptQueue: PromptQueue;
	eventHandler: EventHandler;
	footer: FooterModule;
	pr: PrModule;
	todoist: TodoistModule;
	worktree: WorktreeModule;
	exitProtocol: ExitProtocolModule;
	registered: boolean;
}
