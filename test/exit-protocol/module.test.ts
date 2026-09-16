import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { enqueueExitActions } from "../../src/exit-protocol/event-publishers.ts";
import { createExitProtocolModule } from "../../src/exit-protocol/module.ts";
import { exitProtocolStateDescriptor } from "../../src/exit-protocol/module-state.ts";
import { PromptQueue } from "../../src/prompt-queue.ts";
import { createSharedEvents } from "../../src/shared/events.ts";
import type { ExitAction } from "../../src/shared/exit-actions.ts";
import { createSessionState } from "../../src/state.ts";

type TestExitProtocolModule = {
	sessionStart(context: unknown, sessionId?: string): void;
	deactivate(): void;
};

const createTestExitProtocolModule = (
	options: Parameters<typeof createExitProtocolModule>[0],
): TestExitProtocolModule => {
	const module = createExitProtocolModule(
		options,
	) as unknown as TestExitProtocolModule;
	return {
		...module,
		sessionStart(context, sessionId = "session") {
			options.sessionState.session.activeSessionId = sessionId;
			module.sessionStart(context, sessionId);
		},
	};
};

const actions: ExitAction[] = [
	{
		id: "remove-worktree",
		label:
			'Delete worktree "/repo/.worktrees/feature" and local branch "feature"',
		execute: vi.fn(async () => "completed" as const),
	},
];

function worktree(hasUncommittedChanges = false): never {
	return {
		getWorktreeInfo: () => ({
			worktreePath: "/repo",
			branch: "feature",
			hasUncommittedChanges,
		}),
		removeWorktree: () => actions[0].execute(),
	} as never;
}

function context(overrides: Record<string, unknown> = {}) {
	return {
		cwd: "/repo/.worktrees/feature",
		mode: "tui",
		hasUI: true,
		ui: {
			confirm: vi.fn(async () => true),
			select: vi.fn(async () => "Yes"),
			notify: vi.fn(),
		},
		...overrides,
	} as unknown as ExtensionContext;
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("exit protocol state", () => {
	it("provides common session-state descriptor", () => {
		const state = { active: true };
		expect(exitProtocolStateDescriptor.id).toBe("exitProtocol");
		expect(
			exitProtocolStateDescriptor.restore(
				exitProtocolStateDescriptor.serialize(state),
			),
		).toEqual(state);
	});
});

describe("exit protocol presenter", () => {
	it("consumes rejected prompt queue tasks", () => {
		const catchFailure = vi.fn();
		const promptQueue = {
			enqueue: vi.fn(() => ({ catch: catchFailure })),
		} as unknown as PromptQueue;

		enqueueExitActions(
			promptQueue,
			context(),
			{ actions: [], addAction: vi.fn() },
			() => true,
		);

		expect(catchFailure).toHaveBeenCalledOnce();
	});

	it("publishes exact active and inactive module state payloads", async () => {
		const events = createSharedEvents();
		const sessionState = createSessionState();
		sessionState.session.activeSessionId = "session";
		const updates: unknown[] = [];
		events.moduleStateChangedEvent.subscribe((event) => {
			updates.push(event);
		});
		createTestExitProtocolModule({
			eventHandler: events,
			sessionState,
			promptQueue: new PromptQueue(),
		});

		await events.sessionActivatedEvent.emit({
			context: context(),
			sessionId: "session",
		});
		await events.sessionDeactivatedEvent.emit(undefined);

		expect(updates).toEqual([
			{
				moduleId: "exitProtocol",
				moduleState: { active: true },
				persist: false,
			},
			{
				moduleId: "exitProtocol",
				moduleState: { active: false },
				persist: false,
			},
		]);
	});

	it("rejects events when root session ID is missing", async () => {
		const events = createSharedEvents();
		const sessionState = createSessionState();
		const ctx = context();
		createTestExitProtocolModule({
			eventHandler: events,
			sessionState,
			promptQueue: new PromptQueue(),
			worktree: worktree(),
		});

		await events.sessionActivatedEvent.emit({
			context: ctx,
			sessionId: "session",
		});
		await events.prMergedEvent.emit({
			prUrl: "pr",
			taskMarkedAsCompleted: false,
			sessionId: "session",
		});
	});

	it("uses injected lifecycle dependencies", async () => {
		const events = createSharedEvents();
		const ctx = context();
		const module = createTestExitProtocolModule({
			eventHandler: events,
			sessionState: createSessionState(),
			promptQueue: new PromptQueue(),
			worktree: worktree(),
		});
		module.sessionStart(ctx);

		await events.prMergedEvent.emit({
			prUrl: "pr",
			taskMarkedAsCompleted: false,
			sessionId: "session",
		});
		await new Promise<void>((resolve) => setTimeout(resolve, 0));

		expect(ctx.ui.select).toHaveBeenCalledOnce();
	});

	it("uses Yes-first prompt for clean worktree deletion", async () => {
		const events = createSharedEvents();
		const queue = new PromptQueue();
		const ctx = context();
		const module = createTestExitProtocolModule({
			eventHandler: events,
			sessionState: createSessionState(),
			promptQueue: queue,
			worktree: worktree(),
		});
		module.sessionStart(ctx);

		await events.prMergedEvent.emit({
			prUrl: "pr",
			taskMarkedAsCompleted: false,
			sessionId: "session",
		});
		await queue.drain();

		expect(ctx.ui.select).toHaveBeenCalledWith(
			'Exit protocol\nDelete worktree "/repo" and local branch "feature"',
			["Yes", "No"],
		);
		expect(actions[0].execute).toHaveBeenCalledOnce();
	});

	it("uses No-first prompt for dirty worktree deletion", async () => {
		const events = createSharedEvents();
		const queue = new PromptQueue();
		const ctx = context({
			ui: {
				...context().ui,
				select: vi.fn(async () => "No"),
			},
		});
		const module = createTestExitProtocolModule({
			eventHandler: events,
			sessionState: createSessionState(),
			promptQueue: queue,
			worktree: worktree(true),
		});
		module.sessionStart(ctx);

		await events.prMergedEvent.emit({
			prUrl: "pr",
			taskMarkedAsCompleted: false,
			sessionId: "session",
		});
		await queue.drain();

		expect(ctx.ui.select).toHaveBeenCalledWith(
			'Exit protocol\nDelete worktree "/repo" and local branch "feature"',
			["No", "Yes"],
		);
		expect(actions[0].execute).not.toHaveBeenCalled();
	});

	it("submits clean worktree deletion when Yes is selected", async () => {
		const events = createSharedEvents();
		const queue = new PromptQueue();
		const ctx = context();
		const module = createTestExitProtocolModule({
			eventHandler: events,
			sessionState: createSessionState(),
			promptQueue: queue,
			worktree: worktree(),
		});
		module.sessionStart(ctx);

		await events.prMergedEvent.emit({
			prUrl: "pr",
			taskMarkedAsCompleted: false,
			sessionId: "session",
		});
		await queue.drain();

		expect(ctx.ui.select).toHaveBeenCalledOnce();
		expect(actions[0].execute).toHaveBeenCalledOnce();
	});

	it("does not prompt when no actions are available", async () => {
		const events = createSharedEvents();
		const queue = new PromptQueue();
		const ctx = context();
		const module = createTestExitProtocolModule({
			eventHandler: events,
			sessionState: createSessionState(),
			promptQueue: queue,
		});
		module.sessionStart(ctx);

		await events.prMergedEvent.emit({
			prUrl: "pr",
			taskMarkedAsCompleted: false,
			sessionId: "session",
		});
		await queue.drain();

		expect(ctx.ui.select).not.toHaveBeenCalled();
	});

	it("ignores a visible prompt that becomes stale after reset", async () => {
		const events = createSharedEvents();
		const queue = new PromptQueue();
		let resolvePrompt!: (value: string[]) => void;
		const prompt = new Promise<string[]>((resolve) => {
			resolvePrompt = resolve;
		});
		const ctx = context();
		const select = vi.fn(() => prompt);
		(ctx.ui as unknown as { select: typeof select }).select = select;
		const module = createTestExitProtocolModule({
			eventHandler: events,
			sessionState: createSessionState(),
			promptQueue: queue,
			worktree: worktree(),
		});
		module.sessionStart(ctx);

		await events.prMergedEvent.emit({
			prUrl: "pr",
			taskMarkedAsCompleted: false,
			sessionId: "session",
		});
		await Promise.resolve();
		queue.reset();
		resolvePrompt(["remove-worktree"]);
		await queue.drain();

		expect(actions[0].execute).not.toHaveBeenCalled();
	});

	it("uses sequential confirmations in RPC mode", async () => {
		const events = createSharedEvents();
		const queue = new PromptQueue();
		const select = vi.fn(async () => "Yes");
		const ctx = context({
			mode: "rpc",
			ui: {
				select,
				notify: vi.fn(),
			},
		});
		const module = createTestExitProtocolModule({
			eventHandler: events,
			sessionState: createSessionState(),
			promptQueue: queue,
			worktree: worktree(),
		});
		module.sessionStart(ctx);

		await events.prMergedEvent.emit({
			prUrl: "pr",
			taskMarkedAsCompleted: false,
			sessionId: "session",
		});
		await queue.drain();

		expect(select).toHaveBeenCalledOnce();
	});
});
