import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { PromptQueue } from "../prompt-queue.ts";
import type { Exec } from "../shared/command.ts";
import type { EventHandler, PrMergedEvent } from "../shared/events.ts";
import type { ExitActionResult } from "../shared/exit-actions.ts";
import type { SessionRecord, WorkState } from "../shared/session-state.ts";
import type { SessionState } from "../state.ts";

export type MergeRequest = PrMergedEvent;

export interface TodoistExec {
	run(
		args: readonly string[],
	): Promise<import("../shared/command.ts").CommandResult>;
}

export interface TodoistClientLike {
	completeTask(ref: string, isCurrent?: () => boolean): Promise<void>;
}

export interface TodoistClientFactoryDependencies {
	exec?: Exec;
	createTodoistClient?: (
		ctx: ExtensionContext,
		exec: Exec,
	) => TodoistClientLike;
}

export type IsCurrentOperation = () => boolean;

export interface TodoistTask {
	id: string;
	content: string;
	description: string;
	projectId: string;
	sectionId?: string | null;
	sectionName?: string | null;
	url?: string;
	webUrl?: string;
}

export type TaskClaimWorker = (
	input: TaskClaimWorkerInput,
) => Promise<TaskClaimWorkerResult>;

export const TaskClaimWorkerInputSchema = Type.Object({
	sessionId: Type.String({ minLength: 1 }),
	prompt: Type.String(),
	cwd: Type.String(),
	projectRef: Type.String(),
	prRef: Type.Union([Type.String(), Type.Null()]),
	worktree: Type.Object({
		isWorktree: Type.Boolean(),
		root: Type.Union([Type.String(), Type.Null()]),
		branch: Type.Union([Type.String(), Type.Null()]),
	}),
});

export type TaskClaimWorkerInput = Type.Static<
	typeof TaskClaimWorkerInputSchema
>;

export const TaskDataSchema = Type.Object({
	title: Type.String({ minLength: 1 }),
	description: Type.String(),
	id: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
});

export const TaskClaimWorkerResultSchema = Type.Object({
	sessionId: Type.String({ minLength: 1 }),
	action: Type.Union([Type.Literal("error"), Type.Literal("claim")]),
	taskData: Type.Union([TaskDataSchema, Type.Null()]),
	error: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
});

export type TaskClaimWorkerResult = Type.Static<
	typeof TaskClaimWorkerResultSchema
>;

export interface TodoistProjectSettings {
	todoistProjectRef: string;
	triggersOnlyOnWorktree?: boolean;
}

export interface TodoistProjectMapping {
	projects: Record<string, string | TodoistProjectSettings>;
}

export interface ResolvedProject {
	codingRoot: string;
	todoistProjectRef: string;
	triggersOnlyOnWorktree?: boolean;
}

export type ProjectEntry = string | TodoistProjectSettings;

export interface TodoistState {
	taskRef?: string;
	taskName?: string;
	taskUrl?: string;
	mergePromptedPrUrl?: string;
}

export interface TodoistModule {
	register(): void;
	syncSessionState(session: TodoistSession): Promise<void>;
	taskClaim: {
		pending: boolean;
		completed: boolean;
		session?: TodoistSession;
	};
	maybeAnalyzeTaskClaim(session: TodoistSession, prompt: string): void;
}

export interface TodoistModuleOptions {
	pi?: import("@earendil-works/pi-coding-agent").ExtensionAPI;
	promptQueue: PromptQueue;
	eventHandler: EventHandler;
	sessionState: SessionState;
	getLifecycleEpoch?: () => number;
	dependencies?: {
		exec?: Exec;
		taskClaimWorker?: TaskClaimWorker;
		createTodoistClient?: TodoistClientFactoryDependencies["createTodoistClient"];
	};
}

export type TodoistSession = SessionRecord;

export interface TodoistOperations {
	sessionState: SessionState;
	getSession: () => TodoistSession | null;
	todoist: TodoistModule;
	promptQueue: PromptQueue;
	dependencies: NonNullable<TodoistModuleOptions["dependencies"]>;
	eventHandler: EventHandler;
	emitState(session: TodoistSession): Promise<void>;
	appendState(state: WorkState, prDiscoveryDisabled?: boolean): void;
	refreshFooterStatuses(session: TodoistSession): void;
	replaceSessionState(session: TodoistSession, nextState: WorkState): void;
	completeMergedTask?(
		session: TodoistSession,
		taskRef: string,
		stateSnapshot: WorkState,
		workRevision: number,
		operationGeneration: number,
	): Promise<ExitActionResult>;
}

export interface ClaimTaskData {
	title: string;
	description: string;
	id: string;
}
