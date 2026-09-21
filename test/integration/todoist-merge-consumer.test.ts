import { describe, expect, it, vi } from "vitest";
import { createSharedEvents } from "../../src/shared/events.ts";
import { createSessionState } from "../../src/state.ts";
import { TodoistModule } from "../../src/todoist/module.ts";

const context = {
	cwd: "/repo",
	hasUI: false,
	ui: { notify: vi.fn() },
} as never;

function snapshot() {
	return {
		taskRef: "task-1",
		taskName: "Implement feature",
		prUrl: "https://github.com/o/r/pull/42",
		workRevision: 0,
		sessionId: "old-session",
	};
}

describe("Todoist completion capability", () => {
	it("completes immutable snapshot without active-session guards", async () => {
		const eventHandler = createSharedEvents();
		const sessionState = createSessionState();
		sessionState.moduleState.todoist = {
			taskRef: "task-2",
			taskName: "Current task",
		};
		const updates: unknown[] = [];
		eventHandler.moduleStateChangedEvent.subscribe((update) => {
			updates.push(update);
		});
		const completeTask = vi.fn(async () => undefined);
		const module = new TodoistModule({
			createTodoistClient: () => ({ completeTask }),
			eventHandler,
			sessionState,
		});

		const result = await module.completeMergedTask(snapshot(), context);

		expect(result).toBe("completed");
		expect(completeTask).toHaveBeenCalledWith("task-1");
		expect(updates).toContainEqual(
			expect.objectContaining({
				moduleState: expect.objectContaining({
					taskRef: undefined,
					todoistCompletionAttemptedAt: expect.any(String),
				}),
			}),
		);
	});

	it("returns failure when Todoist completion fails", async () => {
		const eventHandler = createSharedEvents();
		const sessionState = createSessionState();
		const completeTask = vi.fn(async () => {
			throw new Error("unavailable");
		});
		const module = new TodoistModule({
			createTodoistClient: () => ({ completeTask }),
			eventHandler,
			sessionState,
		});

		await expect(module.completeMergedTask(snapshot(), context)).resolves.toBe(
			"failed",
		);
	});
});
