import { describe, expect, it } from "vitest";
import { PromptQueue } from "../../src/prompt-queue.ts";
import { createSharedEvents } from "../../src/shared/events.ts";
import { createSessionState } from "../../src/state.ts";
import {
	createTodoistModule,
	isTodoistState,
} from "../../src/todoist/module.ts";

describe("Todoist module ownership", () => {
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

		expect(module.taskClaim).toEqual({
			pending: false,
			completed: false,
			session: undefined,
		});
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
		expect(isTodoistState({ prUrl: "https://github.com/o/r/pull/42" })).toBe(
			false,
		);
		expect(isTodoistState({ taskRef: 42 })).toBe(false);
	});
});
