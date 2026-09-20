import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { PrModule as PrModuleClass } from "../pr/module.ts";
import type { EventHandler } from "../shared/events.ts";
import type { ExitActionResult } from "../shared/exit-actions.ts";
import type { SessionState } from "../state.ts";
import type { TodoistModule as TodoistModuleClass } from "../todoist/module.ts";
import type { WorktreeModule as WorktreeModuleClass } from "../worktree/module.ts";
import type { PromptQueue } from "./queue.ts";

export type PromptTask<T> = (isCurrent: () => boolean) => Promise<T> | T;

export interface ExitProtocolPrompt {
	taskName?: string;
	worktreePath?: string;
	branch?: string;
	hasUncommittedChanges: boolean;
}

export interface ExitProtocolState {
	worktree: { worktreePath: string; branch: string } | null;
	dirty: boolean | null;
}

type PrModule = Pick<PrModuleClass, "mergeActivePr">;
type TodoistModule = Pick<TodoistModuleClass, "completeMergedTask">;
type WorktreeModule = Pick<
	WorktreeModuleClass,
	"getWorktreeInfo" | "hasUncommittedChanges" | "removeWorktree"
>;

export interface CommandDependencies {
	pi?: ExtensionAPI;
	eventHandler: EventHandler;
	sessionState: SessionState;
	pr: PrModule | null;
	getPr?: () => PrModule | null;
	queue: PromptQueue;
	getContext: () => ExtensionContext | null;
	isCurrent: (context: ExtensionContext) => boolean;
}

export interface PromptQueueModuleOptions {
	pi?: ExtensionAPI;
	eventHandler: EventHandler;
	sessionState: SessionState;
	pr: PrModule | null;
	todoist: TodoistModule | null;
	worktree: WorktreeModule | null;
	queue?: PromptQueue;
}

export interface PromptQueueModules {
	pr: PrModule | null;
	todoist: TodoistModule | null;
	worktree: WorktreeModule | null;
}

export type TodoistCompletionSnapshot = Parameters<
	TodoistModule["completeMergedTask"]
>[0];

export interface PromptContext {
	context: ExtensionContext;
	sessionId: string;
	isCurrent: () => boolean;
}

export type { ExitActionResult };
