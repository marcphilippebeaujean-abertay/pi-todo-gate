const STARTS_EMPTY = "starts empty";
const USES_THE_LATEST_VALID_CUSTOM_STATE_ENTRY =
	"uses the latest valid custom state entry";
const CUSTOM = "custom";
const PI_TODO_GATE_STATE = "pi-todo-gate-state";
const OLD = "old";
const MESSAGE = "message";
const IGNORED = "ignored";
const VALUE_NEW = "new";
const NEW_TASK = "New task";
const TREATS_AN_EXPLICIT_EMPTY_STATE_AS_A =
	"treats an explicit empty state as a clear";
const IGNORES_BRANCH_ONLY_AND_MALFORMED_ENTRIES =
	"ignores branch-only and malformed entries";
const BRANCH = "branch";
const BRANCH_ONLY = "branch-only";
const WRONG = "wrong";
const OTHER = "other";
const CLEARS_PATCHED_KEYS_WHEN_UNDEFINED_IS_SUPPLIED =
	"clears patched keys when undefined is supplied";
const PR = "pr";
const TASK = "task";
const PRESERVES_INHERITED_SESSION_IDS = "preserves inherited session IDs";
const SESSION_123 = "session-123";
const HTTPS_GITHUB_COM_A_B_PULL_1 = "https://github.com/a/b/pull/1";

import { describe, expect, it } from "vitest";
import {
	applyStatePatch,
	emptyWorkState,
	extractInheritedState,
	latestState,
} from "../src/session-state.ts";

describe("session state", () => {
	it(STARTS_EMPTY, () => {
		expect(emptyWorkState()).toEqual({});
	});

	it(USES_THE_LATEST_VALID_CUSTOM_STATE_ENTRY, () => {
		expect(
			latestState([
				{
					type: CUSTOM,
					customType: PI_TODO_GATE_STATE,
					data: { prUrl: OLD },
				},
				{ type: MESSAGE, message: IGNORED },
				{
					type: CUSTOM,
					customType: PI_TODO_GATE_STATE,
					data: {
						taskRef: VALUE_NEW,
						taskName: NEW_TASK,
					},
				},
			]),
		).toEqual({
			taskRef: VALUE_NEW,
			taskName: NEW_TASK,
		});
	});

	it(TREATS_AN_EXPLICIT_EMPTY_STATE_AS_A, () => {
		expect(
			latestState([
				{
					type: CUSTOM,
					customType: PI_TODO_GATE_STATE,
					data: { prUrl: OLD },
				},
				{
					type: CUSTOM,
					customType: PI_TODO_GATE_STATE,
					data: {},
				},
			]),
		).toEqual({});
	});

	it(IGNORES_BRANCH_ONLY_AND_MALFORMED_ENTRIES, () => {
		expect(
			latestState([
				{
					type: BRANCH,
					id: BRANCH_ONLY,
					data: { prUrl: WRONG },
				},
				{
					type: CUSTOM,
					customType: OTHER,
					data: { prUrl: WRONG },
				},
				{
					type: CUSTOM,
					customType: PI_TODO_GATE_STATE,
					data: { prUrl: 42 },
				},
			]),
		).toEqual({});
	});

	it(CLEARS_PATCHED_KEYS_WHEN_UNDEFINED_IS_SUPPLIED, () => {
		expect(
			applyStatePatch({ prUrl: PR, taskRef: TASK }, { prUrl: undefined }),
		).toEqual({ taskRef: TASK });
	});

	it(PRESERVES_INHERITED_SESSION_IDS, () => {
		expect(
			extractInheritedState([
				{
					type: CUSTOM,
					customType: PI_TODO_GATE_STATE,
					data: {
						inheritedFrom: SESSION_123,
						prUrl: HTTPS_GITHUB_COM_A_B_PULL_1,
					},
				},
			]),
		).toEqual({
			inheritedFrom: SESSION_123,
			prUrl: HTTPS_GITHUB_COM_A_B_PULL_1,
		});
	});
});
