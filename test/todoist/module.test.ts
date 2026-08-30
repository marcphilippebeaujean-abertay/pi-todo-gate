import { describe, expect, it } from "vitest";
import { isTodoistState, todoistContext } from "../../src/todoist/state.ts";

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

describe("todoistContext", () => {
	it("generates new-task workflow with configured project", () => {
		const context = todoistContext({}, "Merge TD");

		expect(context).toContain("# Todoist Task Gate (MANDATORY)");
		expect(context).toContain(
			"Find or create a Todoist task matching this work in the configured project.",
		);
		expect(context).toContain("pi_todoist_gate_state using set_task");
		expect(context).toContain("Merge TD");
	});

	it("generates continue context for an active task", () => {
		const context = todoistContext(
			{ taskRef: "42", taskName: "Implement feature" },
			"Merge TD",
		);

		expect(context).toContain(
			"We are tracking tasks with Todoist and you are currently working on task 42.",
		);
		expect(context).toContain(
			"Continue working on and tracking this task in Todoist.",
		);
		expect(context).toContain("Implement feature");
		expect(context).not.toContain("Find or create");
	});
});
