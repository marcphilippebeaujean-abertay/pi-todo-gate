import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { createSharedEvents } from "../../src/shared/events.ts";
import { createSessionState } from "../../src/state.ts";
import { register } from "../../src/todoist/commands.ts";
import type {
	TodoistOperations,
	TodoistSession,
} from "../../src/todoist/internal-state.ts";

const cwd = "/repo";

function context(): ExtensionCommandContext {
	return {
		cwd,
		hasUI: true,
		ui: { notify: vi.fn() },
	} as unknown as ExtensionCommandContext;
}

function runtime(): {
	operations: TodoistOperations;
	sessionState: ReturnType<typeof createSessionState>;
	worker: ReturnType<typeof vi.fn>;
	update: ReturnType<typeof vi.fn>;
} {
	const sessionState = createSessionState();
	sessionState.session.activeSessionId = "session";
	sessionState.moduleState.todoist = {
		taskRef: "task-1",
		taskName: "Old task",
		taskDescription: "Old details",
	};
	const session = {
		context: { cwd, hasUI: true },
		project: { codingRoot: cwd },
		workRevision: 0,
		sessionId: "session",
		operationQueue: Promise.resolve(),
	} as unknown as TodoistSession;
	const worker = vi.fn(async () => ({
		newTaskDescription: "New details",
		newTaskName: "New task",
		hasCompletedTask: false,
	}));
	const update = vi.fn(async () => undefined);
	const operations = {
		sessionState,
		getSession: () => session,
		projectRef: "Project",
		getProjectRef: undefined,
		eventHandler: createSharedEvents(),
		todoist: { taskClaim: { pending: false, completed: false } },
		updateTodoistState: update,
		completeMergedTask: undefined,
		dependencies: {},
		taskRefreshWorker: worker,
	} as unknown as TodoistOperations;
	return { operations, sessionState, worker, update };
}

function commandHandlers(
	runtime: TodoistOperations,
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
		runtime,
	);
	return commands;
}

describe("Todoist task commands", () => {
	it("registers refresh and explicit drop commands", () => {
		const { operations } = runtime();
		expect([...commandHandlers(operations).keys()]).toEqual([
			"tg_refresh_task",
			"tg_drop_task",
		]);
	});

	it("refreshes task using current project reference", async () => {
		const { operations, worker, update } = runtime();
		operations.getProjectRef = () => "Current project";
		const handler = commandHandlers(operations).get("tg_refresh_task")?.handler;
		await handler?.("", context());

		expect(worker).toHaveBeenCalledWith(
			expect.objectContaining({
				taskRef: "task-1",
				taskName: "Old task",
				taskDescription: "Old details",
				projectRef: "Current project",
			}),
		);
		expect(update).toHaveBeenCalledWith(
			expect.objectContaining({
				taskRef: "task-1",
				taskName: "New task",
				taskDescription: "New details",
			}),
			expect.objectContaining({ persist: true }),
		);
	});

	it("ignores refresh result after selected task changes", async () => {
		const { operations, sessionState, worker, update } = runtime();
		worker.mockImplementation(async () => {
			sessionState.moduleState.todoist.taskRef = "task-2";
			return {
				newTaskDescription: "Stale details",
				newTaskName: "Stale task",
				hasCompletedTask: false,
			};
		});
		const handler = commandHandlers(operations).get("tg_refresh_task")?.handler;
		await handler?.("", context());

		expect(update).not.toHaveBeenCalled();
	});

	it("completes and clears selected task", async () => {
		const { operations, worker, update } = runtime();
		worker.mockResolvedValue({
			newTaskDescription: null,
			newTaskName: null,
			hasCompletedTask: true,
		});
		const handler = commandHandlers(operations).get("tg_refresh_task")?.handler;
		await handler?.("", context());

		expect(update).toHaveBeenCalledWith(
			expect.objectContaining({
				taskRef: undefined,
				taskName: undefined,
				taskDescription: undefined,
				taskUrl: undefined,
				todoistCompletionAttemptedAt: expect.any(String),
			}),
			expect.objectContaining({ persist: true }),
		);
	});

	it("drops selected task locally without running worker", async () => {
		const { operations, worker, update } = runtime();
		const handler = commandHandlers(operations).get("tg_drop_task")?.handler;
		await handler?.("", context());

		expect(worker).not.toHaveBeenCalled();
		expect(update).toHaveBeenCalledWith(
			expect.objectContaining({
				taskRef: undefined,
				taskName: undefined,
				taskDescription: undefined,
				taskUrl: undefined,
			}),
			expect.objectContaining({ persist: true }),
		);
	});
});
