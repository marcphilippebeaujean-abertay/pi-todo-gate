import { describe, expect, it } from "vitest";
import {
	applyStatePatch,
	emptyWorkState,
	extractInheritedState,
	latestState,
} from "../src/session-state.ts";

describe("session state", () => {
	it("starts empty", () => {
		expect(emptyWorkState()).toEqual({});
	});

	it("uses the latest valid custom state entry", () => {
		expect(
			latestState([
				{
					type: "custom",
					customType: "pi-todo-gate-state",
					data: { prUrl: "old" },
				},
				{ type: "message", message: "ignored" },
				{
					type: "custom",
					customType: "pi-todo-gate-state",
					data: { taskRef: "new" },
				},
			]),
		).toEqual({ taskRef: "new" });
	});

	it("treats an explicit empty state as a clear", () => {
		expect(
			latestState([
				{
					type: "custom",
					customType: "pi-todo-gate-state",
					data: { prUrl: "old" },
				},
				{ type: "custom", customType: "pi-todo-gate-state", data: {} },
			]),
		).toEqual({});
	});

	it("ignores branch-only and malformed entries", () => {
		expect(
			latestState([
				{ type: "branch", id: "branch-only", data: { prUrl: "wrong" } },
				{ type: "custom", customType: "other", data: { prUrl: "wrong" } },
				{
					type: "custom",
					customType: "pi-todo-gate-state",
					data: { prUrl: 42 },
				},
			]),
		).toEqual({});
	});

	it("clears patched keys when undefined is supplied", () => {
		expect(
			applyStatePatch({ prUrl: "pr", taskRef: "task" }, { prUrl: undefined }),
		).toEqual({ taskRef: "task" });
	});

	it("preserves inherited session IDs", () => {
		expect(
			extractInheritedState([
				{
					type: "custom",
					customType: "pi-todo-gate-state",
					data: {
						inheritedFrom: "session-123",
						prUrl: "https://github.com/a/b/pull/1",
					},
				},
			]),
		).toEqual({
			inheritedFrom: "session-123",
			prUrl: "https://github.com/a/b/pull/1",
		});
	});
});
