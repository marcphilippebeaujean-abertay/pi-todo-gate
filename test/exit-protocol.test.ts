import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createExitProtocolModule } from "../src/exit-protocol/module.ts";
import {
	focusAction,
	focusSubmit,
	initialPickerState,
	toggleAction,
} from "../src/exit-protocol/picker.ts";
import type { ExitAction } from "../src/exit-protocol/types.ts";
import { createSharedEvents } from "../src/shared/events.ts";

const actions: ExitAction[] = [
	{
		id: "complete-todoist-task",
		label: 'Mark Todoist task "Implement feature" complete',
		execute: vi.fn(async () => "completed" as const),
	},
	{
		id: "remove-worktree",
		label:
			'Delete worktree "/repo/.worktrees/feature" and local branch "feature"',
		execute: vi.fn(async () => "deferred" as const),
	},
];

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
	it("presents one combined prompt and submits all actions by default", async () => {
		const events = createSharedEvents();
		const ctx = context();
		const module = createExitProtocolModule(events);
		module.sessionStart(ctx);
		events.on("prMerged", (request) => {
			for (const action of actions) request.addAction(action);
		});

		await events.emit("prMerged", { prUrl: "pr" });

		expect(ctx.ui.custom).toHaveBeenCalledOnce();
		expect(actions[0].execute).toHaveBeenCalledOnce();
		expect(actions[1].execute).toHaveBeenCalledOnce();
	});

	it("does not prompt when no actions are available", async () => {
		const events = createSharedEvents();
		const ctx = context();
		const module = createExitProtocolModule(events);
		module.sessionStart(ctx);

		await events.emit("prMerged", { prUrl: "pr" });

		expect(ctx.ui.custom).not.toHaveBeenCalled();
	});

	it("ignores non-quit close events", async () => {
		const events = createSharedEvents();
		const ctx = context();
		const module = createExitProtocolModule(events);
		module.sessionStart(ctx);
		events.on("sessionWillClose", (request) => {
			for (const action of actions) request.addAction(action);
		});

		await events.emit("sessionWillClose", { reason: "new" });

		expect(ctx.ui.custom).not.toHaveBeenCalled();
		expect(actions[0].execute).not.toHaveBeenCalled();
	});

	it("uses sequential confirmations in RPC mode", async () => {
		const events = createSharedEvents();
		const confirm = vi.fn(async () => true);
		const ctx = context({
			mode: "rpc",
			ui: {
				confirm,
				notify: vi.fn(),
			},
		});
		const module = createExitProtocolModule(events);
		module.sessionStart(ctx);
		events.on("prMerged", (request) => {
			for (const action of actions) request.addAction(action);
		});

		await events.emit("prMerged", { prUrl: "pr" });

		expect(confirm).toHaveBeenCalledTimes(2);
	});
});
