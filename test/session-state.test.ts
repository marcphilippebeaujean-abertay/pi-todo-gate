import { describe, expect, it } from "vitest";
import { createSessionState, type SessionState } from "../src/state.ts";

describe("session state", () => {
	it("creates initialized session metadata and module slices", () => {
		expect(createSessionState()).toEqual({
			session: { activeSessionId: null },
			gitState: {},
			moduleState: {
				pr: {
					discoveryDisabled: false,
					discoveryTestedUrls: [],
					mergedPrs: [],
				},
				todoist: {},
				herdr: {},
				worktree: {},
				footer: { footers: {} },
				exitProtocol: { active: false },
			},
		});
	});

	it("keeps module state contracts distinct", () => {
		const state: SessionState = createSessionState();
		state.moduleState.pr.prUrl = "https://github.com/o/r/pull/42";
		state.moduleState.todoist.taskRef = "42";

		expect(state.moduleState.pr.prUrl).toContain("/pull/42");
		expect(state.moduleState.todoist.taskRef).toBe("42");
	});
});
