import { describe, expect, it, vi } from "vitest";
import { createSharedEvents } from "../../src/shared/events.ts";
import { createSessionState } from "../../src/state.ts";
import type { TodoistSession } from "../../src/todoist/internal-state.ts";
import { createTodoistModule } from "../../src/todoist/module.ts";

const PR_URL = "https://github.com/o/r/pull/42";

function session(hasUI = true): TodoistSession {
	return {
		context: {
			cwd: "/repo",
			hasUI,
			ui: { confirm: vi.fn(async () => true), notify: vi.fn() },
		},
		project: { codingRoot: "/repo" },
		workRevision: 0,
		sessionId: "session",
		operationQueue: Promise.resolve(),
	} as unknown as TodoistSession;
}

describe("Todoist completion capability", () => {
	it("completes immutable merged-task snapshot without UI", async () => {
		const eventHandler = createSharedEvents();
		const sessionState = createSessionState();
		sessionState.session.activeSessionId = "session";
		sessionState.moduleState.todoist = {
			taskRef: "task-1",
			taskName: "Implement feature",
		};
		sessionState.moduleState.pr.prUrl = PR_URL;
		const completeTask = vi.fn(async () => undefined);
		const currentSession = session();
		const module = createTodoistModule({
			loadConfig: async () => ({ projects: { "/repo": "project" } }),
			createTodoistClient: () => ({ completeTask }),
			eventHandler,
			sessionState,
		});
		await eventHandler.sessionActivatedEvent.emit({
			context: currentSession.context,
			sessionId: "session",
			session: currentSession,
		});

		const snapshot = Object.freeze({
			taskRef: "task-1",
			taskName: "Implement feature",
			prUrl: PR_URL,
			workRevision: 0,
			sessionId: "session",
		});
		const result = await module.completeMergedTask(snapshot);

		expect(result).toBe("completed");
		expect(completeTask).toHaveBeenCalledWith("task-1", expect.any(Function));
		expect(currentSession.context.ui.confirm).not.toHaveBeenCalled();
	});

	it("rejects stale immutable snapshot before Todoist call", async () => {
		const eventHandler = createSharedEvents();
		const sessionState = createSessionState();
		sessionState.session.activeSessionId = "session";
		sessionState.moduleState.todoist = { taskRef: "task-2" };
		sessionState.moduleState.pr.prUrl = PR_URL;
		const completeTask = vi.fn(async () => undefined);
		const currentSession = session(false);
		const module = createTodoistModule({
			loadConfig: async () => ({ projects: { "/repo": "project" } }),
			createTodoistClient: () => ({ completeTask }),
			eventHandler,
			sessionState,
		});
		await eventHandler.sessionActivatedEvent.emit({
			context: currentSession.context,
			sessionId: "session",
			session: currentSession,
		});

		const result = await module.completeMergedTask({
			taskRef: "task-1",
			taskName: "Implement feature",
			prUrl: PR_URL,
			workRevision: 0,
			sessionId: "session",
		});

		expect(result).toBe("failed");
		expect(completeTask).not.toHaveBeenCalled();
	});

	it("captures snapshot values before queued completion begins", async () => {
		const eventHandler = createSharedEvents();
		const sessionState = createSessionState();
		sessionState.session.activeSessionId = "session";
		sessionState.moduleState.todoist = { taskRef: "task-1" };
		sessionState.moduleState.pr.prUrl = PR_URL;
		const completeTask = vi.fn(async () => undefined);
		const currentSession = session();
		const module = createTodoistModule({
			loadConfig: async () => ({ projects: { "/repo": "project" } }),
			createTodoistClient: () => ({ completeTask }),
			eventHandler,
			sessionState,
		});
		await eventHandler.sessionActivatedEvent.emit({
			context: currentSession.context,
			sessionId: "session",
			session: currentSession,
		});

		const snapshot = {
			taskRef: "task-1",
			taskName: "Implement feature",
			prUrl: PR_URL,
			workRevision: 0,
			sessionId: "session",
		};
		const completion = module.completeMergedTask(snapshot);
		snapshot.taskRef = "task-2";
		snapshot.prUrl = "https://github.com/o/r/pull/99";
		snapshot.workRevision = 10;
		await completion;

		expect(completeTask).toHaveBeenCalledWith("task-1", expect.any(Function));
	});

	it("publishes cleared state and completion notification after success", async () => {
		const eventHandler = createSharedEvents();
		const updates: unknown[] = [];
		eventHandler.moduleStateChangedEvent.subscribe((update) => {
			updates.push(update);
		});
		const sessionState = createSessionState();
		sessionState.session.activeSessionId = "session";
		sessionState.moduleState.todoist = {
			taskRef: "task-1",
			taskName: "Implement feature",
			taskUrl: "https://app.todoist.com/app/task/task-1",
		};
		sessionState.moduleState.pr.prUrl = PR_URL;
		const notify = vi.fn();
		const currentSession = session();
		currentSession.context.ui.notify = notify;
		const module = createTodoistModule({
			loadConfig: async () => ({ projects: { "/repo": "project" } }),
			createTodoistClient: () => ({
				completeTask: vi.fn(async () => undefined),
			}),
			eventHandler,
			sessionState,
		});
		await eventHandler.sessionActivatedEvent.emit({
			context: currentSession.context,
			sessionId: "session",
			session: currentSession,
		});

		const result = await module.completeMergedTask({
			taskRef: "task-1",
			taskName: "Implement feature",
			prUrl: PR_URL,
			workRevision: 0,
			sessionId: "session",
		});

		expect(result).toBe("completed");
		expect(updates.at(-1)).toEqual(
			expect.objectContaining({
				moduleId: "todoist",
				moduleState: expect.objectContaining({
					taskRef: undefined,
					taskName: undefined,
					taskUrl: undefined,
				}),
				persist: true,
				gitStatePatch: expect.objectContaining({
					mergeCompletedAt: expect.any(String),
				}),
			}),
		);
		expect(notify).toHaveBeenCalledWith(
			"Merged PR detected; Todoist task completed",
			"info",
		);
	});

	it("notifies failure without clearing state when Todoist completion fails", async () => {
		const eventHandler = createSharedEvents();
		const sessionState = createSessionState();
		sessionState.session.activeSessionId = "session";
		sessionState.moduleState.todoist = { taskRef: "task-1" };
		sessionState.moduleState.pr.prUrl = PR_URL;
		const notify = vi.fn();
		const currentSession = session();
		currentSession.context.ui.notify = notify;
		const module = createTodoistModule({
			loadConfig: async () => ({ projects: { "/repo": "project" } }),
			createTodoistClient: () => ({
				completeTask: vi.fn(async () => {
					throw new Error("unavailable");
				}),
			}),
			eventHandler,
			sessionState,
		});
		await eventHandler.sessionActivatedEvent.emit({
			context: currentSession.context,
			sessionId: "session",
			session: currentSession,
		});

		const result = await module.completeMergedTask({
			taskRef: "task-1",
			taskName: "Implement feature",
			prUrl: PR_URL,
			workRevision: 0,
			sessionId: "session",
		});

		expect(result).toBe("failed");
		expect(notify).toHaveBeenCalledWith(
			"Merged PR detected, but Todoist task completion failed",
			"warning",
		);
	});

	it("rejects completion when session revision becomes stale", async () => {
		const eventHandler = createSharedEvents();
		const sessionState = createSessionState();
		sessionState.session.activeSessionId = "session";
		sessionState.moduleState.todoist = { taskRef: "task-1" };
		sessionState.moduleState.pr.prUrl = PR_URL;
		const completeTask = vi.fn(async () => undefined);
		const currentSession = session();
		const module = createTodoistModule({
			loadConfig: async () => ({ projects: { "/repo": "project" } }),
			createTodoistClient: () => ({ completeTask }),
			eventHandler,
			sessionState,
		});
		await eventHandler.sessionActivatedEvent.emit({
			context: currentSession.context,
			sessionId: "session",
			session: currentSession,
		});
		currentSession.workRevision = 1;

		const result = await module.completeMergedTask({
			taskRef: "task-1",
			taskName: "Implement feature",
			prUrl: PR_URL,
			workRevision: 0,
			sessionId: "session",
		});

		expect(result).toBe("failed");
		expect(completeTask).not.toHaveBeenCalled();
	});

	it("serializes direct completion operations per session", async () => {
		const eventHandler = createSharedEvents();
		const sessionState = createSessionState();
		sessionState.session.activeSessionId = "session";
		sessionState.moduleState.todoist = { taskRef: "task-1" };
		sessionState.moduleState.pr.prUrl = PR_URL;
		let releaseFirst!: () => void;
		const firstBlocked = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		let calls = 0;
		const completeTask = vi.fn(async (): Promise<void> => {
			calls += 1;
			if (calls === 1) await firstBlocked;
		});
		const currentSession = session(false);
		const module = createTodoistModule({
			loadConfig: async () => ({ projects: { "/repo": "project" } }),
			createTodoistClient: () => ({ completeTask }),
			eventHandler,
			sessionState,
		});
		await eventHandler.sessionActivatedEvent.emit({
			context: currentSession.context,
			sessionId: "session",
			session: currentSession,
		});
		const snapshot = {
			taskRef: "task-1",
			taskName: "Implement feature",
			prUrl: PR_URL,
			workRevision: 0,
			sessionId: "session",
		};
		const first = module.completeMergedTask(snapshot);
		const second = module.completeMergedTask(snapshot);
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
		expect(completeTask).toHaveBeenCalledTimes(1);
		releaseFirst();
		const [firstResult, secondResult] = await Promise.all([first, second]);
		expect(firstResult).toBe("completed");
		expect(secondResult).toBe("failed");
		expect(completeTask).toHaveBeenCalledTimes(1);
	});
});
