import { describe, expect, it, vi } from "vitest";
import { createSharedEvents } from "../../src/shared/events.ts";
import { createSessionState } from "../../src/state.ts";
import { completeMergedTask } from "../../src/todoist/completion.ts";

const snapshot = {
	taskRef: "task-1",
	taskName: "Task",
	prUrl: "https://github.com/o/r/pull/42",
	workRevision: 0,
	sessionId: "old-session",
};

describe("Todoist completion", () => {
	it("completes task and publishes current shared state without session guards", async () => {
		const sessionState = createSessionState();
		sessionState.moduleState.todoist = { taskRef: "task-1" };
		const events = createSharedEvents();
		const updates: unknown[] = [];
		events.moduleStateChangedEvent.subscribe((update) => {
			updates.push(update);
		});
		const completeTask = vi.fn(async () => {
			sessionState.moduleState.todoist.taskRef = "task-2";
		});
		const context = {
			cwd: "/repo",
			hasUI: false,
			ui: { notify: vi.fn() },
		} as never;

		const result = await completeMergedTask(
			sessionState,
			events,
			context,
			snapshot,
			undefined,
			() => ({ completeTask }),
		);

		expect(result).toBe("completed");
		expect(completeTask).toHaveBeenCalledWith("task-1");
		expect(updates).toContainEqual(
			expect.objectContaining({
				moduleState: expect.objectContaining({
					taskRef: undefined,
					todoistCompletionAttemptedAt: expect.any(String),
				}),
				persist: true,
			}),
		);
	});
});
