import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { createSharedEvents } from "../../src/shared/events.ts";
import { createSessionState } from "../../src/state.ts";
import { register } from "../../src/todoist/commands.ts";
import type { TaskRefreshWorkerResult } from "../../src/todoist/internal-state.ts";

const cwd = "/repo";

function context(): ExtensionCommandContext {
	return {
		cwd,
		hasUI: true,
		ui: { notify: vi.fn() },
	} as unknown as ExtensionCommandContext;
}

function commandHandlers(
	sessionState: ReturnType<typeof createSessionState>,
	events = createSharedEvents(),
	worker: (
		input: Parameters<NonNullable<Parameters<typeof register>[3]>>[0],
	) => Promise<TaskRefreshWorkerResult> = async () => ({
		newTaskDescription: "New details",
		newTaskName: "New task",
		hasCompletedTask: false,
	}),
): Map<
	string,
	{ handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }
> {
	const commands = new Map();
	register(
		{
			registerCommand: (name: string, command: unknown) =>
				commands.set(name, command),
		} as unknown as ExtensionAPI,
		sessionState,
		events,
		worker,
	);
	return commands;
}

function state() {
	const sessionState = createSessionState();
	sessionState.session.activeSessionId = "session";
	sessionState.moduleState.todoist = {
		todoistProjectRef: "Project",
		taskRef: "task-1",
		taskName: "Old task",
		taskDescription: "Old details",
	};
	return sessionState;
}

describe("Todoist task commands", () => {
	it("registers refresh and explicit drop commands", () => {
		const sessionState = state();
		expect([...commandHandlers(sessionState).keys()]).toEqual([
			"tg_refresh_task",
			"tg_drop_task",
		]);
	});

	it("refreshes task using project reference from shared state", async () => {
		const sessionState = state();
		const worker = vi.fn(async () => ({
			newTaskDescription: "New details",
			newTaskName: "New task",
			hasCompletedTask: false,
		}));
		const events = createSharedEvents();
		const updates: unknown[] = [];
		events.moduleStateChangedEvent.subscribe((update) => {
			updates.push(update);
		});
		const handler = commandHandlers(sessionState, events, worker).get(
			"tg_refresh_task",
		)?.handler;

		await handler?.("", context());

		expect(worker).toHaveBeenCalledWith(
			expect.objectContaining({
				taskRef: "task-1",
				taskName: "Old task",
				taskDescription: "Old details",
				projectRef: "Project",
			}),
		);
		expect(updates).toContainEqual(
			expect.objectContaining({
				moduleId: "todoist",
				moduleState: expect.objectContaining({
					taskRef: "task-1",
					taskName: "New task",
					taskDescription: "New details",
				}),
				persist: true,
			}),
		);
	});

	it("applies result to current state after selected task changes", async () => {
		const sessionState = state();
		const events = createSharedEvents();
		const updates: unknown[] = [];
		events.moduleStateChangedEvent.subscribe((update) => {
			updates.push(update);
		});
		const worker = vi.fn(async () => {
			sessionState.moduleState.todoist.taskRef = "task-2";
			return {
				newTaskDescription: "Stale details",
				newTaskName: "Stale task",
				hasCompletedTask: false,
			};
		});
		const handler = commandHandlers(sessionState, events, worker).get(
			"tg_refresh_task",
		)?.handler;

		await handler?.("", context());

		expect(updates).toContainEqual(
			expect.objectContaining({
				moduleState: expect.objectContaining({
					taskRef: "task-2",
					taskName: "Stale task",
				}),
			}),
		);
	});

	it("uses last returned overlapping refresh result", async () => {
		const sessionState = state();
		const events = createSharedEvents();
		const updates: Array<{ taskName?: string }> = [];
		events.moduleStateChangedEvent.subscribe((update) => {
			if (update.moduleId === "todoist") updates.push(update.moduleState);
		});
		let releaseFirst!: (result: TaskRefreshWorkerResult) => void;
		let releaseSecond!: (result: TaskRefreshWorkerResult) => void;
		const first = new Promise<TaskRefreshWorkerResult>((resolve) => {
			releaseFirst = resolve;
		});
		const second = new Promise<TaskRefreshWorkerResult>((resolve) => {
			releaseSecond = resolve;
		});
		const worker = vi
			.fn()
			.mockReturnValueOnce(first)
			.mockReturnValueOnce(second);
		const handler = commandHandlers(sessionState, events, worker).get(
			"tg_refresh_task",
		)?.handler;

		const firstCall = handler?.("", context());
		const secondCall = handler?.("", context());
		releaseSecond({
			newTaskDescription: "Second details",
			newTaskName: "Second task",
			hasCompletedTask: false,
		});
		await secondCall;
		releaseFirst({
			newTaskDescription: "First details",
			newTaskName: "First task",
			hasCompletedTask: false,
		});
		await firstCall;

		expect(updates.map(({ taskName }) => taskName)).toEqual([
			"Second task",
			"First task",
		]);
		expect(sessionState.moduleState.todoist.taskName).toBe("Old task");
	});

	it("completes and clears selected task", async () => {
		const sessionState = state();
		const events = createSharedEvents();
		const updates: unknown[] = [];
		events.moduleStateChangedEvent.subscribe((update) => {
			updates.push(update);
		});
		const worker = vi.fn(async () => ({
			newTaskDescription: null,
			newTaskName: null,
			hasCompletedTask: true,
		}));
		const handler = commandHandlers(sessionState, events, worker).get(
			"tg_refresh_task",
		)?.handler;

		await handler?.("", context());

		expect(updates).toContainEqual(
			expect.objectContaining({
				moduleState: expect.objectContaining({
					taskRef: undefined,
					taskName: undefined,
					taskDescription: undefined,
					taskUrl: undefined,
					todoistCompletionAttemptedAt: expect.any(String),
				}),
			}),
		);
	});

	it("drops selected task locally without running worker", async () => {
		const sessionState = state();
		const events = createSharedEvents();
		const updates: unknown[] = [];
		events.moduleStateChangedEvent.subscribe((update) => {
			updates.push(update);
		});
		const worker = vi.fn();
		const handler = commandHandlers(sessionState, events, worker).get(
			"tg_drop_task",
		)?.handler;

		await handler?.("", context());

		expect(worker).not.toHaveBeenCalled();
		expect(updates).toContainEqual(
			expect.objectContaining({
				moduleState: expect.objectContaining({ taskRef: undefined }),
				persist: true,
			}),
		);
	});
});
