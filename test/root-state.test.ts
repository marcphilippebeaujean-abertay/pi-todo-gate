import { describe, expect, it } from "vitest";
import {
	registerModuleStateConsumer,
	updateModuleState,
} from "../src/event-consumer.ts";
import { createSharedEvents } from "../src/shared/events.ts";
import { createSessionState, type SessionState } from "../src/state.ts";

describe("extension module state", () => {
	it("replaces state for addressed module without touching other modules", () => {
		const state: SessionState = createSessionState();
		state.moduleState.todoist = { taskRef: "42" };

		updateModuleState(state, {
			moduleId: "footer",
			moduleState: { pr: "#42" },
		});

		updateModuleState(state, {
			moduleId: "todoist",
			moduleState: { taskRef: "43" },
		});

		expect(state.moduleState).toEqual({
			footer: { pr: "#42" },
			todoist: { taskRef: "43" },
		});
	});

	it("consumes published module state updates", async () => {
		const state = createSessionState();
		const events = createSharedEvents();
		events.setupListener("updateModuleState", (request) => {
			state.moduleState.direct = request.payload.moduleState;
		});
		registerModuleStateConsumer(events, state);

		await events.emit("updateModuleState", {
			moduleId: "pr",
			moduleState: { prUrl: "https://github.com/o/r/pull/42" },
		});

		expect(state.moduleState.pr).toEqual({
			prUrl: "https://github.com/o/r/pull/42",
		});
	});

	it("starts with null session id", () => {
		expect(createSessionState()).toEqual({
			sessionId: null,
			moduleState: {},
		});
	});
});
