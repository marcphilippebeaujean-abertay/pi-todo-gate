import { describe, expect, it, vi } from "vitest";
import type {
	PrState,
	StateToolDependencies,
} from "../../src/pr/internal-state.ts";
import { executeStateTool } from "../../src/pr/state-tool.ts";
import { createSessionState, type SessionRecord } from "../../src/state.ts";

const PR_URL = "https://github.com/o/r/pull/42";

function session(): SessionRecord {
	return {
		context: { cwd: "/repo", hasUI: false } as never,
		project: { codingRoot: "/repo", todoistProjectRef: "project" },
		hasPendingHandoffContext: false,
		hasPerformedAnyGitMutations: false,
		workRevision: 0,
		operationGeneration: 0,
		operationQueue: Promise.resolve(),
	};
}

function dependencies(
	state: PrState,
	remoteOrigin: string | undefined,
): {
	deps: StateToolDependencies;
	updatePrState: ReturnType<typeof vi.fn>;
} {
	const updatePrState = vi.fn();
	return {
		deps: {
			getSession: () => session(),
			getPrState: () => state,
			getRemoteOrigin: () => remoteOrigin,
			updatePrState: (nextState, persist) => updatePrState(nextState, persist),
			syncPrState: vi.fn(),
		},
		updatePrState,
	};
}

describe("PR state tool", () => {
	it("validates set_pr against Git remote origin", async () => {
		const state = createSessionState().moduleState.pr;
		const { deps, updatePrState } = dependencies(
			state,
			"git@github.com:o/r.git",
		);

		await executeStateTool(
			deps,
			"tool-call",
			{ action: "set_pr", url: PR_URL },
			undefined,
			undefined,
			{} as never,
		);

		expect(updatePrState).toHaveBeenCalledWith(
			expect.objectContaining({ prUrl: PR_URL, discoveryDisabled: true }),
			true,
		);
	});

	it("rejects set_pr from a different Git remote", async () => {
		const state = createSessionState().moduleState.pr;
		const { deps, updatePrState } = dependencies(
			state,
			"git@github.com:other/repo.git",
		);

		await expect(
			executeStateTool(
				deps,
				"tool-call",
				{ action: "set_pr", url: PR_URL },
				undefined,
				undefined,
				{} as never,
			),
		).rejects.toThrow("set_pr requires a valid GitHub pull request URL");
		expect(updatePrState).not.toHaveBeenCalled();
	});
});
