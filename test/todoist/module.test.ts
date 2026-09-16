import { describe, expect, it, vi } from "vitest";
import { registerModuleStateConsumer } from "../../src/event-consumer.ts";
import { PromptQueue } from "../../src/prompt-queue/queue.ts";
import { createSharedEvents } from "../../src/shared/events.ts";
import { createSessionState } from "../../src/state.ts";
import { completeMergedTask } from "../../src/todoist/completion.ts";
import type {
	TodoistSession,
	TodoistState,
	TodoistStateUpdateOptions,
} from "../../src/todoist/internal-state.ts";
import { createTodoistModule as createTodoistModuleFactory } from "../../src/todoist/module.ts";
import {
	applyTodoistStatePatch,
	isTodoistState,
} from "../../src/todoist/parsing.ts";

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
	createTodoistModuleFactory({
		loadConfig: async () => ({
			projects: {
				"/old": "project",
				"/new": "project",
				"/repo": "project",
			},
		}),
		...options,
	}) as unknown as TestTodoistModule;

describe("Todoist module ownership", () => {
	it("projects configured data without exposing mapping details", async () => {
		const module = createTodoistModuleFactory({
			loadConfig: async () => ({
				projects: {
					"/repo": {
						todoistProjectRef: "project",
						triggersOnlyOnWorktree: false,
					},
				},
			}),
			promptQueue: new PromptQueue(),
			eventHandler: createSharedEvents(),
			sessionState: createSessionState(),
		});

		expect(await module.resolveSessionProject("/repo/src")).toEqual({
			codingRoot: "/repo",
			triggersOnlyOnWorktree: false,
		});
	});

	it("ignores malformed injected project entries safely", async () => {
		const module = createTodoistModuleFactory({
			loadConfig: async () => ({
				projects: {
					"/null": null,
					"/number": 42,
					"/array": [],
					"/missing": { triggersOnlyOnWorktree: false },
					"/valid": { todoistProjectRef: "project" },
				},
			}),
			promptQueue: new PromptQueue(),
			eventHandler: createSharedEvents(),
			sessionState: createSessionState(),
		});

		expect(await module.resolveSessionProject("/null")).toBeNull();
		expect(await module.resolveSessionProject("/number")).toBeNull();
		expect(await module.resolveSessionProject("/array")).toBeNull();
		expect(await module.resolveSessionProject("/missing")).toBeNull();
		expect(await module.resolveSessionProject("/valid")).toEqual({
			codingRoot: "/valid",
			triggersOnlyOnWorktree: true,
		});
	});

	it("does not let stale activation reset newer claim state", async () => {
		const events = createSharedEvents();
		const sessionState = createSessionState();
		let releaseOldActivation!: () => void;
		const oldActivationBlocked = new Promise<void>((resolve) => {
			releaseOldActivation = resolve;
		});
		events.sessionActivatedEvent.subscribe(
			async ({ sessionId: activationId }) => {
				if (activationId === "old") await oldActivationBlocked;
			},
		);
		const module = createTodoistModule({
			promptQueue: new PromptQueue(),
			eventHandler: events,
			sessionState,
		});
		const oldContext = { cwd: "/old" } as never;
		const newContext = { cwd: "/new" } as never;
		const oldSession = {
			context: oldContext,
			sessionId: "old",
		} as unknown as TodoistSession;
		const newSession = {
			context: newContext,
			sessionId: "new",
		} as unknown as TodoistSession;
		sessionState.session.activeSessionId = "old";
		const oldActivation = events.sessionActivatedEvent.emit({
			context: oldContext,
			sessionId: "old",
			session: oldSession,
		});
		await Promise.resolve();
		sessionState.session.activeSessionId = "new";
		await events.sessionActivatedEvent.emit({
			context: newContext,
			sessionId: "new",
			session: newSession,
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

	it("ignores before-agent events from stale session IDs", async () => {
		const events = createSharedEvents();
		const worker = vi.fn(async () => ({
			sessionId: "session",
			action: "error" as const,
			taskData: null,
			error: "not a task" as string | null,
		}));
		const sessionState = createSessionState();
		const oldContext = { cwd: "/old", hasUI: false } as never;
		const newContext = { cwd: "/new", hasUI: false } as never;
		const oldSession = {
			context: oldContext,
			sessionId: "old",
		} as unknown as TodoistSession;
		const newSession = {
			context: newContext,
			sessionId: "new",
		} as unknown as TodoistSession;
		sessionState.session.activeSessionId = "old";
		createTodoistModule({
			promptQueue: new PromptQueue(),
			eventHandler: events,
			sessionState,
			taskClaimWorker: worker,
		});

		await events.sessionActivatedEvent.emit({
			context: oldContext,
			sessionId: "old",
			session: oldSession,
		});
		sessionState.session.activeSessionId = "new";
		await events.sessionActivatedEvent.emit({
			context: newContext,
			sessionId: "new",
			session: newSession,
		});
		await events.beforeAgentStartEvent.emit({
			event: { prompt: "stale prompt" } as never,
			context: oldContext,
			sessionId: "old",
			session: oldSession,
			messages: [],
		});

		expect(worker).not.toHaveBeenCalled();
	});

	it("does not start stale worker after session changes during inspection", async () => {
		const events = createSharedEvents();
		const sessionState = createSessionState();
		const oldContext = { cwd: "/old", hasUI: false } as never;
		const newContext = { cwd: "/new", hasUI: false } as never;
		const oldSession = {
			context: oldContext,
			sessionId: "old",
		} as unknown as TodoistSession;
		const newSession = {
			context: newContext,
			sessionId: "new",
		} as unknown as TodoistSession;
		sessionState.session.activeSessionId = "old";
		const worker = vi.fn(async () => ({
			sessionId: "old",
			action: "error" as const,
			taskData: null,
			error: "not a task" as string | null,
		}));
		let releaseInspection!: () => void;
		let markInspectionStarted!: () => void;
		const inspectionStarted = new Promise<void>((resolve) => {
			markInspectionStarted = resolve;
		});
		const inspectionReleased = new Promise<void>((resolve) => {
			releaseInspection = resolve;
		});
		const exec = vi.fn(async (_command: string, args: string[]) => {
			if (args[0] === "rev-parse") {
				markInspectionStarted();
				await inspectionReleased;
			}
			return { stdout: "", stderr: "", code: 1 };
		});
		createTodoistModule({
			promptQueue: new PromptQueue(),
			eventHandler: events,
			sessionState,
			exec,
			taskClaimWorker: worker,
		});

		await events.sessionActivatedEvent.emit({
			context: oldContext,
			sessionId: "old",
			session: oldSession,
		});
		const beforeAgent = events.beforeAgentStartEvent.emit({
			event: { prompt: "stale prompt" } as never,
			context: oldContext,
			sessionId: "old",
			session: oldSession,
			messages: [],
		});
		await inspectionStarted;
		sessionState.session.activeSessionId = "new";
		await events.sessionActivatedEvent.emit({
			context: newContext,
			sessionId: "new",
			session: newSession,
		});
		releaseInspection();
		await beforeAgent;

		expect(worker).not.toHaveBeenCalled();
	});

	it("starts task-claim analysis from shared before-agent events", async () => {
		const events = createSharedEvents();
		const sessionState = createSessionState();
		sessionState.session.activeSessionId = "session";
		const session = {
			context: {
				cwd: "/repo",
				hasUI: false,
				model: { provider: "openai-codex", id: "gpt-5.6-luna" },
			},
			project: { codingRoot: "/repo" },
			hasPendingHandoffContext: false,
			hasPerformedAnyGitMutations: false,
			workRevision: 0,
			sessionId: "session",
			operationQueue: Promise.resolve(),
		} as unknown as TodoistSession;
		const worker = vi.fn(async (input: { sessionId: string }) => ({
			sessionId: input.sessionId,
			action: "error" as const,
			taskData: null,
			error: "not a task" as string | null,
		}));
		createTodoistModule({
			loadConfig: async () => ({
				projects: {
					"/old": "project",
					"/new": "project",
					"/repo": {
						todoistProjectRef: "project",
						triggersOnlyOnWorktree: false,
					},
				},
			}),
			promptQueue: new PromptQueue(),
			eventHandler: events,
			sessionState,
			exec: async () => ({ stdout: "", stderr: "", code: 1 }),
			taskClaimWorker: worker,
		});

		await events.sessionActivatedEvent.emit({
			context: session.context,
			sessionId: "session",
			session,
		});
		await events.beforeAgentStartEvent.emit({
			event: { prompt: "claim this task" } as never,
			context: session.context,
			sessionId: "session",
			session,
			messages: [],
		});
		await new Promise<void>((resolve) => setTimeout(resolve, 0));

		expect(worker).toHaveBeenCalledWith(
			expect.objectContaining({
				prompt: "claim this task",
				model: "openai-codex/gpt-5.6-luna",
				projectRef: "project",
				prRef: null,
			}),
		);
	});

	it("does not claim tasks from ordinary checkouts by default", async () => {
		const events = createSharedEvents();
		const sessionState = createSessionState();
		sessionState.session.activeSessionId = "session";
		const session = {
			context: { cwd: "/repo", hasUI: false },
			project: { codingRoot: "/repo", triggersOnlyOnWorktree: true },
			hasPendingHandoffContext: false,
			hasPerformedAnyGitMutations: false,
			workRevision: 0,
			sessionId: "session",
			operationQueue: Promise.resolve(),
		} as unknown as TodoistSession;
		const worker = vi.fn(async () => ({
			sessionId: "session",
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
			sessionId: "session",
			session,
		});
		await events.beforeAgentStartEvent.emit({
			event: { prompt: "ordinary checkout" } as never,
			context: session.context,
			sessionId: "session",
			session,
			messages: [],
		});
		await new Promise<void>((resolve) => setTimeout(resolve, 0));

		expect(worker).not.toHaveBeenCalled();
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
		sessionState.session.activeSessionId = "session";
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
		const session = {} as unknown as TodoistSession;

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

describe("Todoist module integration", () => {
	it("completes merged task with default module dependencies", async () => {
		const events = createSharedEvents();
		const promptQueue = new PromptQueue();
		const sessionState = createSessionState();
		sessionState.session.activeSessionId = "session";
		sessionState.moduleState.todoist = {
			taskRef: "task-1",
			taskName: "Implement feature",
		};
		sessionState.moduleState.pr.prUrl = "https://github.com/o/r/pull/42";
		const completeTask = vi.fn(async () => undefined);
		const module = createTodoistModuleFactory({
			loadConfig: async () => ({ projects: { "/repo": "project" } }),
			createTodoistClient: () => ({ completeTask }),
			promptQueue,
			eventHandler: events,
			sessionState,
		});
		const session = {
			context: {
				cwd: "/repo",
				hasUI: true,
				ui: { confirm: vi.fn(async () => true), notify: vi.fn() },
			},
			project: { codingRoot: "/repo" },
			workRevision: 0,
			sessionId: "session",
			operationQueue: Promise.resolve(),
		} as unknown as TodoistSession;
		await events.sessionActivatedEvent.emit({
			context: session.context,
			sessionId: "session",
			session,
		});
		await events.prMergedEvent.emit({
			prUrl: sessionState.moduleState.pr.prUrl,
			taskMarkedAsCompleted: false,
			sessionId: "session",
		});
		await promptQueue.drain();
		expect(completeTask).toHaveBeenCalledWith("task-1", expect.any(Function));
		void module;
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
			project: { codingRoot: "/repo" },
			workRevision: 0,
			sessionId: "session",
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
			sessionId: "session",
			session,
		});
		const operations = {
			sessionState,
			getSession: () => session,
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
			"session",
		);

		expect(result).toBe("failed");
	});

	it("increments revision across ABA task identity changes", async () => {
		const events = createSharedEvents();
		const sessionState = createSessionState();
		sessionState.session.activeSessionId = "session";
		const session = {
			context: { cwd: "/repo" },
			project: { codingRoot: "/repo" },
			sessionId: "session",
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
			sessionId: "session",
			session,
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
