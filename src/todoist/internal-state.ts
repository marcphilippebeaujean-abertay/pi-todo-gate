import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { Exec } from "../shared/command.ts";
import type { EventHandler, PrMergedEvent } from "../shared/events.ts";
import type { SessionRecord } from "../shared/session-state.ts";
import type { SessionState } from "../state.ts";
import type { TodoistModuleState as TodoistStateShape } from "./module-state.ts";

export type { TodoistModuleState } from "./module-state.ts";

export type MergeRequest = PrMergedEvent;

export interface TodoistExec {
	run(
		args: readonly string[],
	): Promise<import("../shared/command.ts").CommandResult>;
}

export interface TodoistClientLike {
	completeTask(ref: string): Promise<void>;
}

export interface TodoistClientFactoryDependencies {
	exec?: Exec;
	createTodoistClient?: (
		ctx: ExtensionContext,
		exec: Exec,
	) => TodoistClientLike;
}

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
	model: Type.Optional(Type.String({ minLength: 1 })),
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

export const TaskRefreshWorkerInputSchema = Type.Object({
	sessionId: Type.String({ minLength: 1 }),
	cwd: Type.String(),
	taskRef: Type.String({ minLength: 1 }),
	taskName: Type.String(),
	taskDescription: Type.String(),
	projectRef: Type.String(),
	prRef: Type.Union([Type.String(), Type.Null()]),
	worktree: Type.Object({
		isWorktree: Type.Boolean(),
		root: Type.Union([Type.String(), Type.Null()]),
		branch: Type.Union([Type.String(), Type.Null()]),
	}),
});

export type TaskRefreshWorkerInput = Type.Static<
	typeof TaskRefreshWorkerInputSchema
>;

export const TaskRefreshWorkerResultSchema = Type.Object({
	newTaskDescription: Type.Union([Type.String(), Type.Null()]),
	newTaskName: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
	hasCompletedTask: Type.Boolean(),
});

export type TaskRefreshWorkerResult = Type.Static<
	typeof TaskRefreshWorkerResultSchema
>;

export type TaskRefreshWorker = (
	input: TaskRefreshWorkerInput,
) => Promise<TaskRefreshWorkerResult>;

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

export type TodoistState = TodoistStateShape;

export interface SelectedTaskContext {
	sessionId: string;
	taskRef: string;
}

export interface TodoistLifecycleConsumerOptions {
	eventHandler: EventHandler;
	sessionState: SessionState;
	taskClaimWorker?: TaskClaimWorker;
	exec?: Exec;
	activateSession: (
		session: TodoistSession,
		sessionId: string,
	) => Promise<void>;
	registerCommands: (pi: ExtensionAPI) => void;
}

export interface TodoistModuleOptions {
	pi?: import("@earendil-works/pi-coding-agent").ExtensionAPI;
	eventHandler: EventHandler;
	sessionState: SessionState;
	exec?: Exec;
	taskClaimWorker?: TaskClaimWorker;
	taskRefreshWorker?: TaskRefreshWorker;
	createTodoistClient?: TodoistClientFactoryDependencies["createTodoistClient"];
}

export type TodoistSession = SessionRecord;

export interface TodoistCompletionSnapshot {
	readonly taskRef: string;
	readonly taskName: string;
	readonly prUrl: string;
	readonly workRevision: number;
	readonly sessionId: string;
}

export interface ClaimTaskData {
	title: string;
	description: string;
	id: string;
}
