import { describe, expect, it, vi } from "vitest";
import { EXTENSION_CONSTANTS as C } from "../../src/constants.ts";
import type { ExtensionRuntime } from "../../src/extension-types.ts";
import { createSharedEvents } from "../../src/shared/events.ts";
import { registerTodoistMergeConsumer } from "../../src/todoist/merge-consumer.ts";

const PR_URL = "https://github.com/o/r/pull/42";

function setup(overrides: Record<string, unknown> = {}) {
	const confirm = vi.fn(async () => true);
	const notify = vi.fn();
	const completeTask = vi.fn(async () => undefined);
	const session = {
		sessionId: "session",
		context: { hasUI: true, cwd: "/repo", ui: { confirm, notify } },
		state: { prUrl: PR_URL, taskRef: "task-1", taskName: "Implement feature" },
		workRevision: 0,
		operationQueue: Promise.resolve(),
		...overrides,
	};
	const runtime = {
		active: session,
		events: createSharedEvents(),
		dependencies: {
			createTodoistClient: () => ({ completeTask }),
		},
		pi: { appendEntry: vi.fn() },
		footer: { update: vi.fn() },
	} as unknown as ExtensionRuntime;
	return { runtime, session, confirm, notify, completeTask };
}

async function emit(runtime: ExtensionRuntime) {
	const payload = { prUrl: PR_URL, taskMarkedAsCompleted: false };
	await runtime.events.emit(C.event.prMerged, payload);
	return payload;
}

describe("Todoist merge consumer", () => {
	it("prompts only for an assigned task and marks confirmed completion", async () => {
		const setupResult = setup();
		registerTodoistMergeConsumer(setupResult.runtime);

		const payload = await emit(setupResult.runtime);

		expect(setupResult.confirm).toHaveBeenCalledWith(
			'Mark Todoist task "Implement feature" complete?',
			"Todoist task task-1",
		);
		expect(setupResult.completeTask).toHaveBeenCalledWith(
			"task-1",
			expect.any(Function),
		);
		expect(payload.taskMarkedAsCompleted).toBe(true);
	});

	it("leaves the merge event and task unchanged when declined", async () => {
		const setupResult = setup();
		setupResult.confirm.mockResolvedValue(false);
		registerTodoistMergeConsumer(setupResult.runtime);

		const payload = await emit(setupResult.runtime);

		expect(payload.taskMarkedAsCompleted).toBe(false);
		expect(setupResult.completeTask).not.toHaveBeenCalled();
	});

	it("does not prompt without a task, UI, or after completion failure", async () => {
		const noTask = setup({ state: { prUrl: PR_URL } });
		registerTodoistMergeConsumer(noTask.runtime);
		await emit(noTask.runtime);
		expect(noTask.confirm).not.toHaveBeenCalled();

		const noUi = setup({
			context: { hasUI: false, cwd: "/repo", ui: setup().notify },
		});
		registerTodoistMergeConsumer(noUi.runtime);
		await emit(noUi.runtime);
		expect(noUi.confirm).not.toHaveBeenCalled();

		const failed = setup();
		failed.completeTask.mockRejectedValue(new Error("unavailable"));
		registerTodoistMergeConsumer(failed.runtime);
		const payload = await emit(failed.runtime);
		expect(payload.taskMarkedAsCompleted).toBe(false);
		expect(failed.notify).toHaveBeenCalledWith(
			C.message.mergedFailed,
			C.value.warning,
		);
	});

	it("does not complete a task after the session becomes stale", async () => {
		const setupResult = setup();
		setupResult.confirm.mockImplementation(async () => {
			setupResult.runtime.active = null;
			return true;
		});
		registerTodoistMergeConsumer(setupResult.runtime);

		const payload = await emit(setupResult.runtime);

		expect(setupResult.completeTask).not.toHaveBeenCalled();
		expect(payload.taskMarkedAsCompleted).toBe(false);
	});
});
