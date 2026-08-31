import { describe, expect, it } from "vitest";
import { isTodoistState } from "../../src/todoist/state.ts";

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
