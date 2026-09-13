import { describe, expect, it } from "vitest";
import { PromptQueue } from "../../src/prompt-queue.ts";
import { createSharedEvents } from "../../src/shared/events.ts";
import { createSessionState } from "../../src/state.ts";
import {
	createTodoistModule,
	isTodoistState,
} from "../../src/todoist/module.ts";
import type { TodoistSession } from "../../src/todoist/state.ts";

describe("Todoist module ownership", () => {
	it("does not let stale activation reset newer claim state", async () => {
		const events = createSharedEvents();
		const lifecycleEpoch = { value: 1 };
		let releaseOldActivation!: () => void;
		const oldActivationBlocked = new Promise<void>((resolve) => {
			releaseOldActivation = resolve;
		});
		events.sessionActivatedEvent.subscribe(
			async ({ lifecycleEpoch: epoch }) => {
				if (epoch === 1) await oldActivationBlocked;
			},
		);
		const module = createTodoistModule({
			promptQueue: new PromptQueue(),
			eventHandler: events,
			sessionState: createSessionState(),
			getLifecycleEpoch: () => lifecycleEpoch.value,
		});
		const oldContext = { cwd: "/old" } as never;
		const newContext = { cwd: "/new" } as never;
		const oldSession = {
			context: oldContext,
			state: {},
		} as unknown as TodoistSession;
		const newSession = {
			context: newContext,
			state: {},
		} as unknown as TodoistSession;
		const oldActivation = events.sessionActivatedEvent.emit({
			context: oldContext,
			session: oldSession,
			lifecycleEpoch: 1,
		});
		await Promise.resolve();
		lifecycleEpoch.value = 2;
		await events.sessionActivatedEvent.emit({
			context: newContext,
			session: newSession,
			lifecycleEpoch: 2,
		});
		module.taskClaim.pending = true;
		module.taskClaim.session = newSession;
		releaseOldActivation();
		await oldActivation;

		expect(module.taskClaim.pending).toBe(true);
		expect(module.taskClaim.session).toBe(newSession);
	});

	it("resets claim operation state from typed session reset", async () => {
		const events = createSharedEvents();
		const module = createTodoistModule({
			promptQueue: new PromptQueue(),
			eventHandler: events,
			sessionState: createSessionState(),
		});
		module.taskClaim.pending = true;
		module.taskClaim.completed = true;
		await events.sessionResetEvent.emit(undefined);
		module.taskClaim.pending = true;
		module.taskClaim.completed = true;
		await events.sessionDeactivatedEvent.emit(undefined);

		expect(module.taskClaim).toEqual({
			pending: false,
			completed: false,
			session: undefined,
		});
	});
});

describe("Todoist module projection", () => {
	it("publishes task state under Todoist ownership", async () => {
		const events = createSharedEvents();
		const updates: unknown[] = [];
		events.moduleStateChangedEvent.subscribe((update) => {
			updates.push(update);
		});
		const module = createTodoistModule({
			promptQueue: new PromptQueue(),
			eventHandler: events,
			sessionState: createSessionState(),
		});
		const session = {
			state: {
				taskRef: "42",
				taskName: "Implement feature",
				taskUrl: "https://app.todoist.com/app/task/42",
			},
		} as never;

		await module.syncSessionState(session);

		expect(updates).toEqual([
			expect.objectContaining({
				moduleId: "todoist",
				moduleState: expect.objectContaining({ taskRef: "42" }),
			}),
		]);
	});
});

describe("isTodoistState", () => {
	it("accepts task state and rejects PR-shaped state", () => {
		expect(
			isTodoistState({
				taskRef: "42",
				taskName: "Implement feature",
				taskUrl: "https://app.todoist.com/app/task/42",
			}),
		).toBe(true);
		expect(isTodoistState({ prUrl: "https://github.com/o/r/pull/42" })).toBe(
			false,
		);
		expect(isTodoistState({ taskRef: 42 })).toBe(false);
	});
});
