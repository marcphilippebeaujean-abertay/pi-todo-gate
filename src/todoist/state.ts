import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { Exec } from "../shared/command.ts";
import type { SharedEvents } from "../shared/events.ts";
import type { ExitActionResult } from "../shared/exit-actions.ts";
import type { PromptQueue } from "../shared/prompt-queue.ts";
import type { WorkState } from "../types.ts";

export interface TodoistExec {
	run(
		args: readonly string[],
	): Promise<import("../shared/command.ts").CommandResult>;
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

export interface TodoistSession {
	sessionId: string;
	context: ExtensionContext;
	project: { todoistProjectRef: string };
	state: WorkState;
	allowPrDiscovery: boolean;
	workRevision: number;
	operationGeneration: number;
}

export interface TodoistRuntime {
	active: TodoistSession | null;
	taskClaim: {
		pending: boolean;
		completed: boolean;
		session?: TodoistSession;
	};
	promptQueue: PromptQueue;
	dependencies: { exec?: Exec; taskClaimWorker?: TaskClaimWorker };
	events: SharedEvents;
	appendState(state: WorkState, prDiscoveryDisabled?: boolean): void;
	refreshFooterStatuses(session: TodoistSession): void;
	replaceSessionState(session: TodoistSession, nextState: WorkState): void;
	completeMergedTask(
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
