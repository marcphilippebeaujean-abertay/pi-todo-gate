import { describe, expect, it } from "vitest";
import {
	registerModuleStateConsumer,
	updateModuleState,
} from "../src/event-consumer.ts";
import { EXTENSION_CONSTANTS as C } from "../src/shared/constants.ts";
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

	it("applies module and Git updates as isolated state snapshots", async () => {
		const state = createSessionState();
		state.moduleState.sibling = { nested: { value: "original" } };
		const stateReference = state;
		const events = createSharedEvents();
		const snapshots: Array<{
			previousState: SessionState;
			currentState: SessionState;
		}> = [];
		events.sessionStateChangedEvent.subscribe(
			({ previousState, currentState }) => {
				snapshots.push({ previousState, currentState });
				currentState.moduleState.sibling = {
					nested: { value: "current callback" },
				};
				currentState.moduleState.footer = {
					nested: { value: "current callback" },
				};
				currentState.gitState.remoteOrigin = "callback origin";
			},
		);
		registerModuleStateConsumer(events, state);

		await events.moduleStateChangedEvent.emit({
			moduleId: "footer",
			moduleState: { nested: { value: "updated" } },
			gitStatePatch: { remoteOrigin: "https://github.com/o/r.git" },
		});

		expect(state).toBe(stateReference);
		expect(state.moduleState).toEqual({
			sibling: { nested: { value: "original" } },
			footer: { nested: { value: "updated" } },
		});
		expect(state.gitState).toEqual({
			remoteOrigin: "https://github.com/o/r.git",
		});
		expect(snapshots).toHaveLength(1);
		expect(snapshots[0]?.previousState).toEqual({
			sessionId: null,
			gitState: {},
			moduleState: { sibling: { nested: { value: "original" } } },
		});
		expect(snapshots[0]?.currentState).toEqual({
			sessionId: null,
			gitState: { remoteOrigin: "callback origin" },
			moduleState: {
				sibling: { nested: { value: "current callback" } },
				footer: { nested: { value: "current callback" } },
			},
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
			moduleId: "first",
			moduleState: { nested: { value: "first" } },
		});
		const secondUpdate = events.moduleStateChangedEvent.emit({
			moduleId: "second",
			moduleState: { nested: { value: "second" } },
			gitStatePatch: { branch: "second" },
		});
		await Promise.all([firstUpdate, secondUpdate]);

		expect(snapshots).toHaveLength(2);
		expect(snapshots[0]).toEqual({
			previousState: {
				sessionId: null,
				gitState: {},
				moduleState: {},
			},
			currentState: {
				sessionId: null,
				gitState: {},
				moduleState: { first: { nested: { value: "first" } } },
			},
		});
		expect(snapshots[1]).toEqual({
			previousState: {
				sessionId: null,
				gitState: {},
				moduleState: { first: { nested: { value: "first" } } },
			},
			currentState: {
				sessionId: null,
				gitState: { branch: "second" },
				moduleState: {
					first: { nested: { value: "first" } },
					second: { nested: { value: "second" } },
				},
			},
		});
	});

	it("emits snapshots without cloning transitional application state", async () => {
		const state = createSessionState();
		const applicationState = {
			operationQueue: Promise.resolve(),
			nested: { value: "preserved" },
		};
		state.moduleState[C.module.application] = applicationState;
		const events = createSharedEvents();
		const snapshots: Array<{
			previousState: SessionState;
			currentState: SessionState;
		}> = [];
		events.sessionStateChangedEvent.subscribe((snapshot) => {
			snapshots.push(snapshot);
		});
		registerModuleStateConsumer(events, state);

		await events.moduleStateChangedEvent.emit({
			moduleId: C.module.footer,
			moduleState: { active: true },
		});

		expect(snapshots).toHaveLength(1);
		expect(snapshots[0]?.previousState.moduleState).toEqual({});
		expect(snapshots[0]?.currentState.moduleState).toEqual({
			footer: { active: true },
		});
		expect(state.moduleState[C.module.application]).toBe(applicationState);
	});

	it("consumes published module state updates", async () => {
		const state = createSessionState();
		const events = createSharedEvents();
		events.moduleStateChangedEvent.subscribe((event) => {
			state.moduleState.direct = event.moduleState;
		});
		registerModuleStateConsumer(events, state);

		await events.moduleStateChangedEvent.emit({
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
			gitState: {},
			moduleState: {},
		});
	});
});
