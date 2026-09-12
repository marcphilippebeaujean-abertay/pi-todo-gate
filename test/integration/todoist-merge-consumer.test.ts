import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { createExitProtocolModule } from "../../src/exit-protocol/module.ts";
import { register } from "../../src/pr/module.ts";
import { PromptQueue } from "../../src/prompt-queue.ts";
import { EXTENSION_CONSTANTS as C } from "../../src/shared/constants.ts";
import { createSharedEvents } from "../../src/shared/events.ts";
import type { SessionRecord } from "../../src/state.ts";
import { registerTodoistMergeConsumer } from "../../src/todoist/module.ts";
import type { TodoistRuntime } from "../../src/todoist/state.ts";

const PR_URL = "https://github.com/o/r/pull/42";

function setup(overrides: Record<string, unknown> = {}) {
	const { promptQueue: promptQueueOverride, ...sessionOverrides } = overrides;
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
		...sessionOverrides,
	} as unknown as SessionRecord;
	const activeSession: SessionRecord | null = session;
	const sessionState = {
		sessionId: session.sessionId,
		gitState: {},
		moduleState: {},
	};
	const runtime = {
		sessionState,
		todoist: {
			taskClaim: { pending: false, completed: false, session: undefined },
		},
		eventHandler: createSharedEvents(),
		getSession: () => activeSession,
		promptQueue:
			(promptQueueOverride as PromptQueue | undefined) ?? new PromptQueue(),
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
				runtime.getSession() === targetSession &&
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
	} as unknown as TodoistRuntime;

	return { runtime, session, confirm, notify, completeTask };
}

async function emit(runtime: TodoistRuntime) {
	const payload = { prUrl: PR_URL, taskMarkedAsCompleted: false };
	await runtime.eventHandler.prMergedEvent.emit(payload);
	await runtime.promptQueue.drain();
	return payload;
}

async function runMergeCommand(
	runtime: TodoistRuntime,
	context: ExtensionCommandContext,
): Promise<void> {
	let handler:
		| ((args: string, ctx: ExtensionCommandContext) => Promise<void>)
		| undefined;
	const pi = {
		on: vi.fn(),
		registerCommand: (
			_name: string,
			command: {
				handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
			},
		) => {
			handler = command.handler;
		},
	} as unknown as ExtensionAPI;
	register(pi, runtime);
	await handler?.("", context);
}

describe("Todoist merge consumer", () => {
	it("consumes rejected completion prompt queue tasks", async () => {
		const catchFailure = vi.fn();
		const promptQueue = {
			enqueue: vi.fn(() => ({ catch: catchFailure })),
			drain: vi.fn(async () => undefined),
		} as unknown as PromptQueue;
		const setupResult = setup({ promptQueue });
		registerTodoistMergeConsumer(setupResult.runtime);

		await emit(setupResult.runtime);

		expect(catchFailure).toHaveBeenCalledOnce();
	});

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
			setupResult.runtime.eventHandler,
			setupResult.runtime.promptQueue,
			undefined,
			{
				getWorktreeInfo: () => ({ worktreePath: "/repo", branch: "feature" }),
				removeWorktree: async () => {
					order.push("exit");
					return "completed";
				},
			} as never,
		);
		exitModule.sessionStart(
			setupResult.session.context as unknown as ExtensionContext,
		);
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
			setupResult.runtime.getSession = () => null;
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
		} as unknown as SessionRecord;
		const sessionState = {
			sessionId: session.sessionId,
			gitState: {},
			moduleState: {},
		};
		const runtime = {
			sessionState,
			todoist: {
				taskClaim: { pending: false, completed: false, session: undefined },
			},
			promptQueue: new PromptQueue(),
			dependencies: {
				exec,
				createTodoistClient: () => ({ completeTask }),
			},
			eventHandler: createSharedEvents(),
			getSession: () => session,
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
					runtime.getSession() === targetSession &&
					targetSession.operationGeneration === generation;
				if (!isCurrent()) return "failed" as const;
				await completeTask(taskRef, isCurrent);
				return isCurrent() ? ("completed" as const) : ("failed" as const);
			},
		} as unknown as TodoistRuntime;

		registerTodoistMergeConsumer(runtime);

		await runMergeCommand(runtime, context);
		await runtime.promptQueue.drain();

		expect(exec).toHaveBeenCalledWith(
			"gh",
			["pr", "merge", PR_URL, "--merge"],
			{ cwd: "/repo" },
		);
		expect(completeTask).toHaveBeenCalledWith("task-1", expect.any(Function));
	});
});
