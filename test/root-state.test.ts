import { describe, expect, it } from "vitest";
import {
	registerModuleStateConsumer,
	updateModuleState,
} from "../src/event-consumer.ts";
import { createSharedEvents } from "../src/shared/events.ts";
import { createSessionState, type SessionState } from "../src/state.ts";

function initialModuleState() {
	return createSessionState().moduleState;
}

describe("extension module state", () => {
	it("replaces state for addressed module without touching other modules", () => {
		const state: SessionState = createSessionState();
		state.moduleState.todoist = { taskRef: "42" };

		updateModuleState(state, {
			moduleId: "footer",
			moduleState: { footers: {} },
		});

		updateModuleState(state, {
			moduleId: "todoist",
			moduleState: { taskRef: "43" },
		});

		expect(state.moduleState.footer).toEqual({ footers: {} });
		expect(state.moduleState.todoist).toEqual({ taskRef: "43" });
		expect(state.moduleState.pr).toEqual(initialModuleState().pr);
	});

	it("applies module and Git updates as isolated state snapshots", async () => {
		const state = createSessionState();
		state.moduleState.pr.prUrl = "original";
		const stateReference = state;
		const events = createSharedEvents();
		const snapshots: Array<{
			previousState: SessionState;
			currentState: SessionState;
		}> = [];
		events.sessionStateChangedEvent.subscribe(
			({ previousState, currentState }) => {
				snapshots.push({ previousState, currentState });
				currentState.moduleState.pr.prUrl = "callback pr";
				currentState.moduleState.footer = { footers: {} };
				currentState.gitState.remoteOrigin = "callback origin";
			},
		);
		registerModuleStateConsumer(events, state);

		await events.moduleStateChangedEvent.emit({
			moduleId: "footer",
			moduleState: { footers: {} },
			gitStatePatch: { remoteOrigin: "https://github.com/o/r.git" },
		});

		expect(state).toBe(stateReference);
		expect(state.moduleState.pr.prUrl).toBe("original");
		expect(state.moduleState.footer).toEqual({ footers: {} });
		expect(state.gitState).toEqual({
			remoteOrigin: "https://github.com/o/r.git",
		});
		expect(snapshots).toHaveLength(1);
		expect(snapshots[0]?.previousState.moduleState.pr.prUrl).toBe("original");
		expect(snapshots[0]?.currentState.moduleState.pr.prUrl).toBe("callback pr");
		expect(snapshots[0]?.currentState.gitState).toEqual({
			remoteOrigin: "callback origin",
		});
	});

	it("serializes concurrent updates into isolated snapshots", async () => {
		const state = createSessionState();
		const events = createSharedEvents();
		const snapshots: Array<{
			previousState: SessionState;
			currentState: SessionState;
		}> = [];
		events.sessionStateChangedEvent.subscribe((snapshot) => {
			snapshots.push(snapshot);
		});
		registerModuleStateConsumer(events, state);

		const firstUpdate = events.moduleStateChangedEvent.emit({
			moduleId: "pr",
			moduleState: {
				prUrl: "first",
				discoveryDisabled: false,
				discoveryTestedUrls: [],
				mergedPrs: [],
			},
		});
		const secondUpdate = events.moduleStateChangedEvent.emit({
			moduleId: "todoist",
			moduleState: { taskRef: "second" },
			gitStatePatch: { branch: "second" },
		});
		await Promise.all([firstUpdate, secondUpdate]);

		expect(snapshots).toHaveLength(2);
		expect(snapshots[0]?.previousState.moduleState).toEqual(
			initialModuleState(),
		);
		expect(snapshots[0]?.currentState.moduleState.pr.prUrl).toBe("first");
		expect(snapshots[1]?.previousState.moduleState.pr.prUrl).toBe("first");
		expect(snapshots[1]?.currentState.moduleState.todoist).toEqual({
			taskRef: "second",
		});
		expect(snapshots[1]?.currentState.gitState).toEqual({ branch: "second" });
	});

	it("consumes published module state updates", async () => {
		const state = createSessionState();
		const events = createSharedEvents();
		registerModuleStateConsumer(events, state);

		await events.moduleStateChangedEvent.emit({
			moduleId: "pr",
			moduleState: {
				prUrl: "https://github.com/o/r/pull/42",
				discoveryDisabled: false,
				discoveryTestedUrls: [],
				mergedPrs: [],
			},
		});

		expect(state.moduleState.pr).toEqual({
			prUrl: "https://github.com/o/r/pull/42",
			discoveryDisabled: false,
			discoveryTestedUrls: [],
			mergedPrs: [],
		});
	});

	it("starts with null active session id", () => {
		expect(createSessionState().session).toEqual({ activeSessionId: null });
	});
});
