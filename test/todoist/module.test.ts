import { describe, expect, it, vi } from "vitest";
import { registerModuleStateConsumer } from "../../src/event-consumer.ts";
import { PromptQueue } from "../../src/prompt-queue.ts";
import { createSharedEvents } from "../../src/shared/events.ts";
import { createSessionState } from "../../src/state.ts";
import { completeMergedTask } from "../../src/todoist/completion.ts";
import type {
	TodoistSession,
	TodoistState,
	TodoistStateUpdateOptions,
} from "../../src/todoist/internal-state.ts";
import {
	applyTodoistStatePatch,
	createTodoistModule as createTodoistModuleFactory,
	isTodoistState,
} from "../../src/todoist/module.ts";

type TestTodoistModule = {
	taskClaim: {
		pending: boolean;
		completed: boolean;
		session?: unknown;
	};
	syncSessionState(session: unknown): Promise<void>;
	updateState(
		state: TodoistState,
		options: TodoistStateUpdateOptions,
	): Promise<void>;
};

const createTodoistModule = (
	options: Parameters<typeof createTodoistModuleFactory>[0],
): TestTodoistModule =>
	createTodoistModuleFactory(options) as unknown as TestTodoistModule;

describe("Todoist module ownership", () => {
	it("does not let stale activation reset newer claim state", async () => {
		const events = createSharedEvents();
		const lifecycleEpoch = { value: 1 };
		let releaseOldActivation!: () => void;
		const oldActivationBlocked = new Promise<void>((resolve) => {
			releaseOldActivation = resolve;
		});
		events.sessionActivatedEvent.subscribe(
			async ({ lifecycleEpoch: epoch }) => {
				if (epoch === 1) await oldActivationBlocked;
			},
		);
		const module = createTodoistModule({
			promptQueue: new PromptQueue(),
			eventHandler: events,
			sessionState: createSessionState(),
			getLifecycleEpoch: () => lifecycleEpoch.value,
		});
		const oldContext = { cwd: "/old" } as never;
		const newContext = { cwd: "/new" } as never;
		const oldSession = {
			context: oldContext,
		} as unknown as TodoistSession;
		const newSession = {
			context: newContext,
		} as unknown as TodoistSession;
		const oldActivation = events.sessionActivatedEvent.emit({
			context: oldContext,
			session: oldSession,
			lifecycleEpoch: 1,
		});
		await Promise.resolve();
		lifecycleEpoch.value = 2;
		await events.sessionActivatedEvent.emit({
			context: newContext,
			session: newSession,
			lifecycleEpoch: 2,
		});
		module.taskClaim.pending = true;
		module.taskClaim.session = newSession;
		releaseOldActivation();
		await oldActivation;

		expect(module.taskClaim.pending).toBe(true);
		expect(module.taskClaim.session).toBe(newSession);
	});

	it("resets claim operation state from typed session reset", async () => {
		const events = createSharedEvents();
		const module = createTodoistModule({
			promptQueue: new PromptQueue(),
			eventHandler: events,
			sessionState: createSessionState(),
		});
		module.taskClaim.pending = true;
		module.taskClaim.completed = true;
		await events.sessionResetEvent.emit(undefined);
		module.taskClaim.pending = true;
		module.taskClaim.completed = true;
		await events.sessionDeactivatedEvent.emit(undefined);

		expect(module.taskClaim).toEqual({
			pending: false,
			completed: false,
			session: undefined,
		});
	});

	it("starts task-claim analysis from shared before-agent events", async () => {
		const events = createSharedEvents();
		const sessionState = createSessionState();
		sessionState.session.activeSessionId = "session";
		const session = {
			context: { cwd: "/repo", hasUI: false },
			project: { codingRoot: "/repo", todoistProjectRef: "project" },
			hasPendingHandoffContext: false,
			hasPerformedAnyGitMutations: false,
			workRevision: 0,
			operationGeneration: 0,
			operationQueue: Promise.resolve(),
		} as unknown as TodoistSession;
		const worker = vi.fn(async (input: { sessionId: string }) => ({
			sessionId: input.sessionId,
			action: "error" as const,
			taskData: null,
			error: "not a task" as string | null,
		}));
		createTodoistModule({
			promptQueue: new PromptQueue(),
			eventHandler: events,
			sessionState,
			exec: async () => ({ stdout: "", stderr: "", code: 1 }),
			taskClaimWorker: worker,
		});

		await events.sessionActivatedEvent.emit({
			context: session.context,
			session,
			lifecycleEpoch: 0,
		});
		await events.beforeAgentStartEvent.emit({
			event: { prompt: "claim this task" } as never,
			context: session.context,
			session,
			messages: [],
		});
		await new Promise<void>((resolve) => setTimeout(resolve, 0));

		expect(worker).toHaveBeenCalledWith(
			expect.objectContaining({
				prompt: "claim this task",
				projectRef: "project",
				prRef: null,
			}),
		);
	});
});

describe("Todoist module projection", () => {
	it("publishes task state under Todoist ownership", async () => {
		const events = createSharedEvents();
		const updates: unknown[] = [];
		events.moduleStateChangedEvent.subscribe((update) => {
			updates.push(update);
		});
		const sessionState = createSessionState();
		sessionState.moduleState.todoist = {
			taskRef: "42",
			taskName: "Implement feature",
			taskUrl: "https://app.todoist.com/app/task/42",
		};
		const module = createTodoistModule({
			promptQueue: new PromptQueue(),
			eventHandler: events,
			sessionState,
		});
		const session = {} as TodoistSession;

		await module.syncSessionState(session);

		expect(updates).toEqual([
			expect.objectContaining({
				moduleId: "todoist",
				moduleState: {
					taskRef: "42",
					taskName: "Implement feature",
					taskUrl: "https://app.todoist.com/app/task/42",
				},
				persist: false,
			}),
		]);
	});
});

describe("Todoist task identity", () => {
	it("rejects stale completion after ABA task identity changes", async () => {
		const events = createSharedEvents();
		const sessionState = createSessionState();
		sessionState.session.activeSessionId = "session";
		sessionState.moduleState.todoist = { taskRef: "task-a" };
		sessionState.moduleState.pr.prUrl = "https://github.com/o/r/pull/42";
		const session = {
			context: { cwd: "/repo", hasUI: false },
			project: { codingRoot: "/repo", todoistProjectRef: "project" },
			workRevision: 0,
			operationGeneration: 0,
			operationQueue: Promise.resolve(),
		} as unknown as TodoistSession;
		registerModuleStateConsumer(events, sessionState, () => true);
		const module = createTodoistModule({
			promptQueue: new PromptQueue(),
			eventHandler: events,
			sessionState,
		});
		await events.sessionActivatedEvent.emit({
			context: session.context,
			session,
			lifecycleEpoch: 0,
		});
		const operations = {
			sessionState,
			getSession: () => session,
			getLifecycleEpoch: () => 0,
			dependencies: {
				createTodoistClient: () => ({
					completeTask: async (_ref: string, isCurrent: () => boolean) => {
						await module.updateState({ taskRef: "task-b" }, { persist: false });
						await module.updateState({ taskRef: "task-a" }, { persist: false });
						expect(isCurrent()).toBe(false);
					},
				}),
			},
			updateTodoistState: (
				state: TodoistState,
				options: TodoistStateUpdateOptions,
			) => module.updateState(state, options),
			promptQueue: new PromptQueue(),
			eventHandler: events,
			todoist: module,
		} as never;

		const result = await completeMergedTask(
			operations,
			session,
			session.context as never,
			"task-a",
			{ taskRef: "task-a", prUrl: sessionState.moduleState.pr.prUrl },
			0,
			0,
		);

		expect(result).toBe("failed");
	});

	it("increments revision across ABA task identity changes", async () => {
		const events = createSharedEvents();
		const sessionState = createSessionState();
		sessionState.session.activeSessionId = "session";
		const session = {
			context: { cwd: "/repo" },
			project: { codingRoot: "/repo", todoistProjectRef: "project" },
			workRevision: 0,
		} as unknown as TodoistSession;
		registerModuleStateConsumer(events, sessionState, () => true);
		const module = createTodoistModule({
			promptQueue: new PromptQueue(),
			eventHandler: events,
			sessionState,
		});
		await events.sessionActivatedEvent.emit({
			context: session.context,
			session,
			lifecycleEpoch: 0,
		});
		sessionState.moduleState.todoist = { taskRef: "task-a" };

		await module.updateState({ taskRef: "task-b" }, { persist: false });
		await module.updateState({ taskRef: "task-a" }, { persist: false });

		expect(session.workRevision).toBe(2);
	});
});

describe("isTodoistState", () => {
	it("accepts task state and rejects PR-shaped state", () => {
		expect(
			isTodoistState({
				taskRef: "42",
				taskName: "Implement feature",
				taskUrl: "https://app.todoist.com/app/task/42",
			}),
		).toBe(true);
		expect(
			isTodoistState({ todoistCompletionAttemptedAt: "2026-01-01T00:00:00Z" }),
		).toBe(true);
		expect(isTodoistState({ prUrl: "https://github.com/o/r/pull/42" })).toBe(
			false,
		);
		expect(isTodoistState({ taskRef: 42 })).toBe(false);
	});

	it("patches completion-attempted state", () => {
		expect(
			applyTodoistStatePatch(
				{ taskRef: "42" },
				{ todoistCompletionAttemptedAt: "2026-01-01T00:00:00Z" },
			),
		).toEqual({
			taskRef: "42",
			todoistCompletionAttemptedAt: "2026-01-01T00:00:00Z",
		});
		expect(
			applyTodoistStatePatch(
				{ todoistCompletionAttemptedAt: "old" },
				{ todoistCompletionAttemptedAt: undefined },
			),
		).toEqual({});
	});
});
