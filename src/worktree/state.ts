import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type {
	JsonValue,
	ModuleStateDescriptor,
} from "../session-state-persistence.ts";
import type { EventHandler } from "../shared/events.ts";
import type { SessionState, WorktreeModuleState } from "../state.ts";
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

function restoreWorktreeState(value: unknown): WorktreeModuleState {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		return {};
	const candidate = value as Record<string, unknown>;
	const hasInvalidInitialHead =
		candidate.initialHead !== undefined &&
		typeof candidate.initialHead !== "string";
	const hasInvalidInitialStatus =
		candidate.initialStatus !== undefined &&
		typeof candidate.initialStatus !== "string";
	if (hasInvalidInitialHead || hasInvalidInitialStatus) return {};
	const initialHead =
		typeof candidate.initialHead === "string"
			? candidate.initialHead
			: undefined;
	const initialStatus =
		typeof candidate.initialStatus === "string"
			? candidate.initialStatus
			: undefined;
	return {
		...(initialHead === undefined ? {} : { initialHead }),
		...(initialStatus === undefined ? {} : { initialStatus }),
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
