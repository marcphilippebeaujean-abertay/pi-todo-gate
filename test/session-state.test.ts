import { describe, expect, expectTypeOf, it } from "vitest";
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
				review: {},
				herdrTabRename: {},
				worktree: {},
				footer: { footers: {} },
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

	it("rejects Todoist fields from the PR module slice at type level", () => {
		type PrState = SessionState["moduleState"]["pr"];
		expectTypeOf<PrState>().toMatchTypeOf<{
			prUrl?: string;
			discoveryDisabled: boolean;
		}>();
		expectTypeOf<PrState>().not.toMatchTypeOf<{ taskRef: string }>();

		const invalidPrState: PrState = {
			discoveryDisabled: false,
			discoveryTestedUrls: [],
			mergedPrs: [],
			// @ts-expect-error PR state must reject Todoist task fields.
			taskRef: "42",
		};
		expect(invalidPrState.discoveryDisabled).toBe(false);
	});
});
