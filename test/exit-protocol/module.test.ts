import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { enqueueExitActions } from "../../src/exit-protocol/event-publishers.ts";
import { createExitProtocolModule } from "../../src/exit-protocol/module.ts";
import {
	focusAction,
	focusSubmit,
	initialPickerState,
	toggleAction,
} from "../../src/exit-protocol/state.ts";
import { PromptQueue } from "../../src/prompt-queue.ts";
import { createSharedEvents } from "../../src/shared/events.ts";
import type { ExitAction } from "../../src/shared/exit-actions.ts";

const actions: ExitAction[] = [
	{
		id: "remove-worktree",
		label:
			'Delete worktree "/repo/.worktrees/feature" and local branch "feature"',
		execute: vi.fn(async () => "completed" as const),
	},
];

function worktree(): never {
	return {
		getWorktreeInfo: () => ({ worktreePath: "/repo", branch: "feature" }),
		removeWorktree: () => actions[0].execute(),
	} as never;
}

function context(overrides: Record<string, unknown> = {}) {
	return {
		cwd: "/repo/.worktrees/feature",
		mode: "tui",
		hasUI: true,
		ui: {
			theme: {
				fg: (_color: string, text: string) => text,
				bold: (text: string) => text,
			},
			custom: vi.fn(
				async (
					factory: (
						tui: unknown,
						theme: unknown,
						kb: unknown,
						done: (value: unknown) => void,
					) => unknown,
				) => {
					let value: unknown;
					const done = (next: unknown) => {
						value = next;
					};
					const component = factory(
						{ requestRender: vi.fn() },
						{
							fg: (_color: string, text: string) => text,
							bold: (text: string) => text,
						},
						{},
						done,
					) as { handleInput(data: string): void };
					component.handleInput("\r");
					return value;
				},
			),
			confirm: vi.fn(async () => true),
			notify: vi.fn(),
		},
		...overrides,
	} as unknown as ExtensionContext;
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("exit protocol picker state", () => {
	it("starts with every action selected and Submit focused", () => {
		const state = initialPickerState([
			"complete-todoist-task",
			"remove-worktree",
		]);

		expect([...state.selectedIds]).toEqual([
			"complete-todoist-task",
			"remove-worktree",
		]);
		expect(state.focused).toBe("submit");
	});

	it("toggles one action and can return focus to Submit", () => {
		const initial = initialPickerState([
			"complete-todoist-task",
			"remove-worktree",
		]);
		const toggled = toggleAction(initial, "remove-worktree");

		expect([...toggled.selectedIds]).toEqual(["complete-todoist-task"]);
		expect(focusAction(toggled, "remove-worktree").focused).toEqual({
			type: "action",
			id: "remove-worktree",
		});
		expect(focusSubmit(toggled).focused).toBe("submit");
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

	it("uses injected lifecycle dependencies", async () => {
		const events = createSharedEvents();
		const ctx = context();
		const module = createExitProtocolModule({
			eventHandler: events,
			promptQueue: new PromptQueue(),
			worktree: worktree(),
		});
		module.sessionStart(ctx);

		await events.prMergedEvent.emit({
			prUrl: "pr",
			taskMarkedAsCompleted: false,
			sessionId: "session",
			lifecycleEpoch: 0,
		});
		await new Promise<void>((resolve) => setTimeout(resolve, 0));

		expect(ctx.ui.custom).toHaveBeenCalledOnce();
	});

	it("presents one combined prompt and submits all actions by default", async () => {
		const events = createSharedEvents();
		const queue = new PromptQueue();
		const ctx = context();
		const module = createExitProtocolModule({
			eventHandler: events,
			promptQueue: queue,
			worktree: worktree(),
		});
		module.sessionStart(ctx);

		await events.prMergedEvent.emit({
			prUrl: "pr",
			taskMarkedAsCompleted: false,
			sessionId: "session",
			lifecycleEpoch: 0,
		});
		await queue.drain();

		expect(ctx.ui.custom).toHaveBeenCalledOnce();
		expect(actions[0].execute).toHaveBeenCalledOnce();
	});

	it("does not prompt when no actions are available", async () => {
		const events = createSharedEvents();
		const queue = new PromptQueue();
		const ctx = context();
		const module = createExitProtocolModule({
			eventHandler: events,
			promptQueue: queue,
		});
		module.sessionStart(ctx);

		await events.prMergedEvent.emit({
			prUrl: "pr",
			taskMarkedAsCompleted: false,
			sessionId: "session",
			lifecycleEpoch: 0,
		});
		await queue.drain();

		expect(ctx.ui.custom).not.toHaveBeenCalled();
	});

	it("ignores a visible prompt that becomes stale after reset", async () => {
		const events = createSharedEvents();
		const queue = new PromptQueue();
		let resolvePrompt!: (value: string[]) => void;
		const prompt = new Promise<string[]>((resolve) => {
			resolvePrompt = resolve;
		});
		const ctx = context();
		const custom = vi.fn(() => prompt);
		(ctx.ui as unknown as { custom: typeof custom }).custom = custom;
		const module = createExitProtocolModule({
			eventHandler: events,
			promptQueue: queue,
			worktree: worktree(),
		});
		module.sessionStart(ctx);

		await events.prMergedEvent.emit({
			prUrl: "pr",
			taskMarkedAsCompleted: false,
			sessionId: "session",
			lifecycleEpoch: 0,
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
		const confirm = vi.fn(async () => true);
		const ctx = context({
			mode: "rpc",
			ui: {
				confirm,
				notify: vi.fn(),
			},
		});
		const module = createExitProtocolModule({
			eventHandler: events,
			promptQueue: queue,
			worktree: worktree(),
		});
		module.sessionStart(ctx);

		await events.prMergedEvent.emit({
			prUrl: "pr",
			taskMarkedAsCompleted: false,
			sessionId: "session",
			lifecycleEpoch: 0,
		});
		await queue.drain();

		expect(confirm).toHaveBeenCalledOnce();
	});
});
