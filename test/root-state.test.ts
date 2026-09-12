import { describe, expect, it } from "vitest";
import {
	registerModuleStateConsumer,
	updateModuleState,
} from "../src/event-consumer.ts";
import { createSharedEvents } from "../src/shared/events.ts";
import { createExtensionState, type ExtensionState } from "../src/state.ts";

describe("extension module state", () => {
	it("replaces state for addressed module without touching other modules", () => {
		const state: ExtensionState = createExtensionState();
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
		const state = createExtensionState();
		const events = createSharedEvents();
		registerModuleStateConsumer(events, state);

		await events.emit("updateModuleState", {
			moduleId: "pr",
			moduleState: { prUrl: "https://github.com/o/r/pull/42" },
		});

		expect(state.moduleState.pr).toEqual({
			prUrl: "https://github.com/o/r/pull/42",
		});
	});
});
