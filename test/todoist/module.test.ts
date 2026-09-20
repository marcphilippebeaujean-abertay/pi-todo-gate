import { describe, expect, it, vi } from "vitest";
import { registerModuleStateConsumer } from "../../src/event-consumer.ts";
import { createSharedEvents } from "../../src/shared/events.ts";
import { createSessionState } from "../../src/state.ts";
import { handleTaskClaimResult } from "../../src/todoist/event-consumers.ts";
import type { TodoistSession } from "../../src/todoist/internal-state.ts";
import { createTodoistModule } from "../../src/todoist/module.ts";

function session(projectRef = "project", cwd = "/repo"): TodoistSession {
	return {
		context: { cwd, hasUI: false, ui: { notify: vi.fn() } },
		project: {
			codingRoot: cwd,
			isTodoistProject: true,
			todoistProjectRef: projectRef,
		},
		hasPendingHandoffContext: false,
		hasPerformedAnyGitMutations: false,
		workRevision: 0,
		sessionId: "session",
		operationQueue: Promise.resolve(),
	} as unknown as TodoistSession;
}

describe("Todoist module", () => {
	it("registers Todoist commands once when tools become available", async () => {
		const events = createSharedEvents();
		const registerCommand = vi.fn();
		createTodoistModule({
			eventHandler: events,
			sessionState: createSessionState(),
		});

		await events.piToolRegistrationsBecameAvailableEvent.emit({
			pi: { registerCommand } as never,
		});
		await events.piToolRegistrationsBecameAvailableEvent.emit({
			pi: { registerCommand } as never,
		});

		expect(registerCommand).toHaveBeenCalledTimes(2);
		expect(registerCommand.mock.calls.map(([name]) => name)).toEqual([
			"tg_refresh_task",
			"tg_drop_task",
		]);
	});

	it("publishes project reference from session capability into shared state", async () => {
		const events = createSharedEvents();
		const sessionState = createSessionState();
		const updates: unknown[] = [];
		events.moduleStateChangedEvent.subscribe((update) => {
			updates.push(update);
		});
		createTodoistModule({ eventHandler: events, sessionState });
		const currentSession = session("Pi Extensions");

		await events.sessionActivatedEvent.emit({
			context: currentSession.context,
			sessionId: "session",
			session: currentSession,
		});

		expect(updates).toContainEqual(
			expect.objectContaining({
				moduleId: "todoist",
				moduleState: expect.objectContaining({
					todoistProjectRef: "Pi Extensions",
				}),
			}),
		);
	});

	it("uses last returned claim result", async () => {
		const events = createSharedEvents();
		const sessionState = createSessionState();
		registerModuleStateConsumer(events, sessionState);
		const currentSession = session("Current project");

		handleTaskClaimResult(sessionState, events, currentSession, {
			sessionId: "session",
			result: {
				sessionId: "session",
				action: "claim",
				taskData: {
					title: "Second result",
					description: "Second details",
					id: "task-2",
				},
				error: null,
			},
		});
		handleTaskClaimResult(sessionState, events, currentSession, {
			sessionId: "session",
			result: {
				sessionId: "session",
				action: "claim",
				taskData: {
					title: "Last result",
					description: "Last details",
					id: "task-last",
				},
				error: null,
			},
		});
		await new Promise<void>((resolve) => setTimeout(resolve, 0));

		expect(sessionState.moduleState.todoist.taskRef).toBe("task-last");
		expect(sessionState.moduleState.todoist.taskName).toBe("Last result");
	});

	it("accepts claim result after session transition", async () => {
		const events = createSharedEvents();
		const sessionState = createSessionState();
		registerModuleStateConsumer(events, sessionState);
		const currentSession = session("Current project");

		handleTaskClaimResult(sessionState, events, currentSession, {
			sessionId: "old-session",
			result: {
				sessionId: "old-session",
				action: "claim",
				taskData: {
					title: "Claimed task",
					description: "Details",
					id: "task-42",
				},
				error: null,
			},
		});
		await new Promise<void>((resolve) => setTimeout(resolve, 0));

		expect(sessionState.moduleState.todoist).toEqual({
			taskRef: "task-42",
			taskName: "Claimed task",
			taskDescription: "Details",
			taskUrl: "https://app.todoist.com/app/task/task-42",
		});
	});
});
