import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { EventHandler } from "../shared/events.ts";
import type {
	JsonValue,
	ModuleStateDescriptor,
	WorktreeModuleState,
} from "../shared/session-state.ts";
import type { SessionState } from "../state.ts";
export interface WorktreeBaseline {
	worktreePath: string;
	branch: string;
	mainRoot: string;
	initialHead: string;
	initialStatus: string;
}

export interface WorktreeCurrentState {
	currentHead: string;
	currentStatus: string;
}

function isOptionalString(value: unknown): boolean {
	return value === undefined || typeof value === "string";
}

function restoreWorktreeState(value: unknown): WorktreeModuleState {
	const isObjectValue = typeof value === "object" && value !== null;
	const isArrayValue = Array.isArray(value);
	const isInvalidValue = !isObjectValue || isArrayValue;
	if (isInvalidValue) return {};
	const candidate = value as Record<string, unknown>;
	const hasValidInitialHead = isOptionalString(candidate.initialHead);
	const hasValidInitialStatus = isOptionalString(candidate.initialStatus);
	const hasValidState = hasValidInitialHead && hasValidInitialStatus;
	if (!hasValidState) return {};
	const initialHead = candidate.initialHead;
	const initialStatus = candidate.initialStatus;
	return {
		...(initialHead === undefined
			? {}
			: { initialHead: initialHead as string }),
		...(initialStatus === undefined
			? {}
			: { initialStatus: initialStatus as string }),
	};
}

export const worktreeStateDescriptor: ModuleStateDescriptor<"worktree"> = {
	id: "worktree",
	createInitialState: () => ({}),
	restore: restoreWorktreeState,
	serialize: (state): JsonValue => structuredClone(state) as JsonValue,
};

export interface WorktreeModuleDependencies {
	exec?: import("../shared/command.ts").Exec;
	changeDirectory?: (path: string) => void;
}

export interface WorktreeModuleOptions {
	eventHandler: EventHandler;
	sessionState: SessionState;
	getLifecycleEpoch?: () => number;
	dependencies?: WorktreeModuleDependencies;
}

export interface CleanupOptions {
	exec: import("../shared/command.ts").Exec;
	changeDirectory: (path: string) => void;
	notify: (message: string, level?: "info" | "warning") => void;
	isCurrent: () => boolean;
	worktreeRemoved?: { value: boolean };
}

export interface WorktreeInfo {
	worktreePath: string;
	branch: string;
}

export interface WorktreeModule {
	sessionStart(ctx: ExtensionContext): Promise<void>;
	deactivate(): void;
	getWorktreeInfo(): WorktreeInfo | null;
	getHasUncommittedChanges(): boolean;
	removeWorktree(): Promise<
		import("../shared/exit-actions.ts").ExitActionResult
	>;
}
