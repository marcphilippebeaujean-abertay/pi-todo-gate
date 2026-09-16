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
});
