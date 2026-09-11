import type {
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { EXTENSION_CONSTANTS as C } from "../../src/constants.ts";
import { createExitProtocolModule } from "../../src/exit-protocol/module.ts";
import type { ExtensionRuntime } from "../../src/extension-types.ts";
import { runMergeProtocol } from "../../src/pr/module.ts";
import { createSharedEvents } from "../../src/shared/events.ts";
import { PromptQueue } from "../../src/shared/prompt-queue.ts";
import { registerTodoistMergeConsumer } from "../../src/todoist/module.ts";

const PR_URL = "https://github.com/o/r/pull/42";

function setup(overrides: Record<string, unknown> = {}) {
	const confirm = vi.fn(async (_title: string) => true);
	const notify = vi.fn();
	const completeTask = vi.fn(
		async (_taskRef?: string, _isCurrent?: () => boolean) => undefined,
	);
	const session = {
		sessionId: "session",
		context: {
			hasUI: true,
			cwd: "/repo",
			ui: {
				confirm,
				notify,
				theme: { fg: (_color: string, text: string) => text },
			},
		},
		state: {
			prUrl: PR_URL,
			taskRef: "task-1",
			taskName: "Implement feature",
			taskUrl: "https://app.todoist.com/app/task/task-1",
		},
		workRevision: 0,
		operationGeneration: 0,
		operationQueue: Promise.resolve(),
		...overrides,
	};
	const runtime = {
		active: session,
		events: createSharedEvents(),
		promptQueue: new PromptQueue(),
		dependencies: {
			createTodoistClient: () => ({ completeTask }),
		},
		pi: { appendEntry: vi.fn() },
		footer: { update: vi.fn() },
		completeMergedTask: async (
			targetSession: typeof session,
			taskRef: string,
			_stateSnapshot: typeof session.state,
			_workRevision: number,
			generation: number,
		) => {
			const isCurrent = () =>
				(runtime.active as unknown) === targetSession &&
				targetSession.operationGeneration === generation;
			if (!isCurrent()) return "failed" as const;
			try {
				await completeTask(taskRef, isCurrent);
			} catch {
				notify(C.message.mergedFailed, C.value.warning);
				return "failed" as const;
			}
			return isCurrent() ? ("completed" as const) : ("failed" as const);
		},
	} as unknown as ExtensionRuntime;
	return { runtime, session, confirm, notify, completeTask };
}

async function emit(runtime: ExtensionRuntime) {
	const payload = { prUrl: PR_URL, taskMarkedAsCompleted: false };
	await runtime.events.emit(C.event.prMerged, payload);
	await runtime.promptQueue.drain();
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

	it("runs before Exit Protocol prompts in shared queue order", async () => {
		const setupResult = setup();
		const order: string[] = [];
		setupResult.confirm.mockImplementation(async (title) => {
			order.push(title.startsWith("Mark Todoist") ? "todoist" : "exit-prompt");
			return true;
		});
		registerTodoistMergeConsumer(setupResult.runtime);
		const exitModule = createExitProtocolModule(
			setupResult.runtime.events,
			setupResult.runtime.promptQueue,
		);
		exitModule.sessionStart(
			setupResult.session.context as unknown as ExtensionContext,
		);
		setupResult.runtime.events.on("prMerged", (request) => {
			request.addAction({
				id: "remove-worktree",
				label: "Run exit action",
				execute: async () => {
					order.push("exit");
					return "completed";
				},
			});
		});

		await emit(setupResult.runtime);

		expect(order).toEqual(["todoist", "exit-prompt", "exit"]);
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

	it("does not complete a task after operation invalidation", async () => {
		const setupResult = setup();
		setupResult.confirm.mockImplementation(async () => {
			setupResult.session.operationGeneration += 1;
			return true;
		});
		registerTodoistMergeConsumer(setupResult.runtime);

		const payload = await emit(setupResult.runtime);

		expect(setupResult.completeTask).not.toHaveBeenCalled();
		expect(payload.taskMarkedAsCompleted).toBe(false);
	});

	it("resolves the direct merge command when completion is confirmed", async () => {
		const confirm = vi.fn(async () => true);
		const completeTask = vi.fn(
			async (_taskRef?: string, _isCurrent?: () => boolean) => undefined,
		);
		const exec = vi.fn(async () => ({ stdout: "", stderr: "", code: 0 }));
		const context = {
			cwd: "/repo",
			hasUI: true,
			ui: {
				confirm,
				notify: vi.fn(),
				theme: { fg: (_color: string, text: string) => text },
			},
		} as unknown as ExtensionCommandContext;
		const session = {
			sessionId: "session",
			context,
			state: {
				prUrl: PR_URL,
				taskRef: "task-1",
				taskName: "Implement feature",
				taskUrl: "https://app.todoist.com/app/task/task-1",
			},
			workRevision: 0,
			operationGeneration: 0,
			operationQueue: Promise.resolve(),
		};
		const runtime = {
			active: session,
			promptQueue: new PromptQueue(),
			dependencies: {
				exec,
				createTodoistClient: () => ({ completeTask }),
			},
			events: createSharedEvents(),
			pi: { appendEntry: vi.fn() },
			footer: { update: vi.fn() },
			completeMergedTask: async (
				targetSession: typeof session,
				taskRef: string,
				_stateSnapshot: typeof session.state,
				_workRevision: number,
				generation: number,
			) => {
				const isCurrent = () =>
					(runtime.active as unknown) === targetSession &&
					targetSession.operationGeneration === generation;
				if (!isCurrent()) return "failed" as const;
				await completeTask(taskRef, isCurrent);
				return isCurrent() ? ("completed" as const) : ("failed" as const);
			},
		} as unknown as ExtensionRuntime;
		registerTodoistMergeConsumer(runtime);

		await runMergeProtocol(runtime, context);
		await runtime.promptQueue.drain();

		expect(exec).toHaveBeenCalledWith(
			"gh",
			["pr", "merge", PR_URL, "--merge"],
			{ cwd: "/repo" },
		);
		expect(completeTask).toHaveBeenCalledWith("task-1", expect.any(Function));
	});
});
