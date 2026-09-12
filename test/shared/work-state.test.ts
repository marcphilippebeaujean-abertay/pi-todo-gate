import { describe, expect, it } from "vitest";
import { isCurrentMerge } from "../../src/shared/work-state.ts";
import {
	currentSessionContext,
	type ExtensionState,
	type SessionContext,
} from "../../src/state.ts";

const PR_URL = "https://github.com/owner/repo/pull/42";
const TASK_REF = "task-42";

function session(): SessionContext {
	return {
		sessionId: "session",
		context: {} as SessionContext["context"],
		project: {} as SessionContext["project"],
		state: { prUrl: PR_URL, taskRef: TASK_REF },
		allowPrDiscovery: false,
		prDiscoveryTestedUrls: new Set(),
		handoffContext: false,
		workChanged: false,
		hasUncommittedChanges: false,
		workRevision: 3,
		operationGeneration: 7,
		operationQueue: Promise.resolve(),
	};
}

describe("isCurrentMerge", () => {
	it("rejects a merge result from an invalidated operation", () => {
		const active = session();
		const sessionState = {
			sessionId: active.sessionId,
			gitState: {},
			moduleState: {},
		};
		const runtime = { sessionState } as unknown as ExtensionState;
		currentSessionContext(sessionState, active);

		expect(isCurrentMerge(runtime, active, 3, 6, TASK_REF, PR_URL)).toBe(false);
	});

	it("accepts a merge result from the current operation and work identity", () => {
		const active = session();
		const sessionState = {
			sessionId: active.sessionId,
			gitState: {},
			moduleState: {},
		};
		const runtime = { sessionState } as unknown as ExtensionState;
		currentSessionContext(sessionState, active);

		expect(isCurrentMerge(runtime, active, 3, 7, TASK_REF, PR_URL)).toBe(true);
	});
});
