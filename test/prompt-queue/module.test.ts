import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPromptQueueModule } from "../../src/prompt-queue/module.ts";
import { PromptQueue } from "../../src/prompt-queue/queue.ts";
import { createSharedEvents } from "../../src/shared/events.ts";
import type { SessionRecord } from "../../src/shared/session-state.ts";
import { createSessionState } from "../../src/state.ts";

const sessionId = "session";

function context(overrides: Record<string, unknown> = {}): ExtensionContext {
	return {
		cwd: "/repo/.worktrees/feature",
		mode: "rpc",
		hasUI: true,
		ui: {
			confirm: vi.fn(async () => true),
			select: vi.fn(async (_title: string, options: string[]) => options[0]),
			notify: vi.fn(),
			custom: vi.fn(async () => ["remove-worktree"]),
		},
		...overrides,
	} as unknown as ExtensionContext;
}

function session(ctx: ExtensionContext): SessionRecord {
	return {
		context: ctx,
		project: { codingRoot: "/repo" },
		hasPendingHandoffContext: false,
		hasPerformedAnyGitMutations: false,
		workRevision: 3,
		operationQueue: Promise.resolve(),
	};
}

function pi(): ExtensionAPI & {
	commands: Map<
		string,
		{ handler: (args: string, ctx: ExtensionContext) => Promise<void> }
	>;
} {
	const commands = new Map();
	return {
		commands,
		on: vi.fn(),
		registerCommand: vi.fn((name, options) => commands.set(name, options)),
	} as unknown as ExtensionAPI & {
		commands: Map<
			string,
			{ handler: (args: string, ctx: ExtensionContext) => Promise<void> }
		>;
	};
}

function setup() {
	const eventHandler = createSharedEvents();
	const sessionState = createSessionState();
	sessionState.session.activeSessionId = sessionId;
	const ctx = context();
	const currentSession = session(ctx);
	const pr = { mergeActivePr: vi.fn(async () => true) };
	const todoist = {
		resolveSessionProject: vi.fn(async () => null),
		completeMergedTask: vi.fn(async () => "completed" as const),
	};
	const worktree = {
		getWorktreeInfo: vi.fn(() => ({
			worktreePath: "/repo/.worktrees/feature",
			branch: "feature",
		})),
		hasUncommittedChanges: vi.fn(async (): Promise<boolean | null> => false),
		removeWorktree: vi.fn(
			async (): Promise<"completed" | "failed"> => "completed",
		),
	};
	const api = pi();
	const queue = new PromptQueue();
	const module = createPromptQueueModule({
		pi: api,
		eventHandler,
		sessionState,
		pr,
		todoist,
		worktree,
		queue,
	});
	return {
		api,
		ctx,
		currentSession,
		eventHandler,
		sessionState,
		pr,
		todoist,
		worktree,
		queue,
		module,
	};
}

async function activate(setupState: ReturnType<typeof setup>): Promise<void> {
	await setupState.eventHandler.sessionActivatedEvent.emit({
		context: setupState.ctx,
		sessionId,
		session: setupState.currentSession,
	});
}

beforeEach(() => vi.clearAllMocks());

describe("Prompt Queue orchestration", () => {
	it("confirms merge then calls direct PR capability", async () => {
		const state = setup();
		state.sessionState.moduleState.pr.prUrl = "https://github.com/o/r/pull/1";
		await activate(state);
		await state.eventHandler.piToolRegistrationsBecameAvailableEvent.emit({
			pi: state.api,
		});
		await state.api.commands.get("tg_merge")?.handler("", state.ctx);

		expect(state.ctx.ui.confirm).toHaveBeenCalledOnce();
		expect(state.pr.mergeActivePr).toHaveBeenCalledOnce();
	});

	it("suppresses cancelled merge", async () => {
		const state = setup();
		state.sessionState.moduleState.pr.prUrl = "https://github.com/o/r/pull/1";
		(state.ctx.ui.confirm as ReturnType<typeof vi.fn>).mockResolvedValue(false);
		await activate(state);
		await state.eventHandler.piToolRegistrationsBecameAvailableEvent.emit({
			pi: state.api,
		});
		await state.api.commands.get("tg_merge")?.handler("", state.ctx);

		expect(state.pr.mergeActivePr).not.toHaveBeenCalled();
	});

	it("synchronously queues Todoist completion before removal confirmation", async () => {
		const state = setup();
		state.sessionState.moduleState.pr.prUrl = "https://github.com/o/r/pull/1";
		state.sessionState.moduleState.todoist.taskRef = "42";
		state.sessionState.moduleState.todoist.taskName = "Task";
		await activate(state);
		await state.eventHandler.prMergedEvent.emit({
			prUrl: "https://github.com/o/r/pull/1",
			taskMarkedAsCompleted: false,
			sessionId,
		});
		await (state.module as { drain?: () => Promise<void> }).drain?.();

		expect(state.todoist.completeMergedTask).toHaveBeenCalledWith({
			taskRef: "42",
			taskName: "Task",
			prUrl: "https://github.com/o/r/pull/1",
			workRevision: 3,
			sessionId,
		});
		expect(state.worktree.removeWorktree).toHaveBeenCalledWith({
			force: false,
		});
	});

	it("passes dirty confirmation as force true", async () => {
		const state = setup();
		(state.ctx.ui.select as ReturnType<typeof vi.fn>).mockResolvedValue("Yes");
		state.worktree.hasUncommittedChanges.mockResolvedValue(true);
		state.sessionState.moduleState.todoist.taskRef = undefined;
		await activate(state);
		await state.eventHandler.prMergedEvent.emit({
			prUrl: "https://github.com/o/r/pull/1",
			taskMarkedAsCompleted: false,
			sessionId,
		});
		await (state.module as { drain?: () => Promise<void> }).drain?.();

		expect(state.ctx.ui.notify).toHaveBeenCalledWith(
			"Worktree /repo/.worktrees/feature has uncommitted work. Deleting it will permanently remove that work.",
			"warning",
		);
		expect(state.worktree.removeWorktree).toHaveBeenCalledWith({ force: true });
	});

	it("defaults dirty worktree removal to No", async () => {
		const state = setup();
		state.worktree.hasUncommittedChanges.mockResolvedValue(true);
		state.sessionState.moduleState.todoist.taskRef = undefined;
		await activate(state);
		await state.eventHandler.prMergedEvent.emit({
			prUrl: "https://github.com/o/r/pull/1",
			taskMarkedAsCompleted: false,
			sessionId,
		});
		await (state.module as { drain?: () => Promise<void> }).drain?.();

		expect(state.ctx.ui.select).toHaveBeenCalledWith(
			`Remove worktree?
Delete worktree "/repo/.worktrees/feature" and local branch "feature"?`,
			["No", "Yes"],
		);
		expect(state.worktree.removeWorktree).not.toHaveBeenCalled();
	});

	it("runs removal confirmation after cancelled Todoist confirmation", async () => {
		const state = setup();
		state.sessionState.moduleState.todoist.taskRef = "42";
		(state.ctx.ui.confirm as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce(false)
			.mockResolvedValueOnce(true);
		await activate(state);
		await state.eventHandler.prMergedEvent.emit({
			prUrl: "https://github.com/o/r/pull/1",
			taskMarkedAsCompleted: false,
			sessionId,
		});
		await (state.module as { drain?: () => Promise<void> }).drain?.();

		expect(state.todoist.completeMergedTask).not.toHaveBeenCalled();
		expect(state.worktree.removeWorktree).toHaveBeenCalled();
	});

	it("resets queued work on session deactivation", async () => {
		const state = setup();
		state.sessionState.moduleState.todoist.taskRef = "42";
		await activate(state);
		await state.eventHandler.prMergedEvent.emit({
			prUrl: "https://github.com/o/r/pull/1",
			taskMarkedAsCompleted: false,
			sessionId,
		});
		await state.eventHandler.sessionDeactivatedEvent.emit(undefined);

		expect(state.todoist.completeMergedTask).not.toHaveBeenCalled();
		expect(state.worktree.removeWorktree).not.toHaveBeenCalled();
	});

	it("queues merge confirmation through same FIFO queue", async () => {
		const state = setup();
		state.sessionState.moduleState.pr.prUrl = "https://github.com/o/r/pull/1";
		await activate(state);
		await state.eventHandler.piToolRegistrationsBecameAvailableEvent.emit({
			pi: state.api,
		});
		const enqueue = vi.spyOn(state.queue, "enqueue");
		await state.api.commands.get("tg_merge")?.handler("", state.ctx);

		expect(enqueue).toHaveBeenCalledOnce();
		expect(state.pr.mergeActivePr).toHaveBeenCalledOnce();
	});

	it("runs Todoist completion before worktree removal", async () => {
		const state = setup();
		const order: string[] = [];
		state.sessionState.moduleState.todoist.taskRef = "42";
		state.todoist.completeMergedTask.mockImplementation(async () => {
			order.push("todoist");
			return "completed";
		});
		state.worktree.removeWorktree.mockImplementation(async () => {
			order.push("exit");
			return "completed";
		});
		await activate(state);
		await state.eventHandler.prMergedEvent.emit({
			prUrl: "https://github.com/o/r/pull/1",
			taskMarkedAsCompleted: false,
			sessionId,
		});
		await (state.module as { drain: () => Promise<void> }).drain();

		expect(order).toEqual(["todoist", "exit"]);
	});

	it("uses yes-no confirmation for worktree removal in TUI mode", async () => {
		const state = setup();
		state.ctx.mode = "tui";
		state.ctx.ui.custom = vi.fn(async () => {
			throw new Error("custom picker must not run");
		}) as never;
		await activate(state);
		await state.eventHandler.prMergedEvent.emit({
			prUrl: "https://github.com/o/r/pull/1",
			taskMarkedAsCompleted: true,
			sessionId,
		});
		await (state.module as { drain: () => Promise<void> }).drain();

		expect(state.ctx.ui.select).toHaveBeenCalledOnce();
		expect(state.ctx.ui.custom).not.toHaveBeenCalled();
		expect(state.worktree.removeWorktree).toHaveBeenCalledWith({
			force: false,
		});
	});

	it("does not present empty actions", async () => {
		const state = setup();
		state.worktree.getWorktreeInfo.mockReturnValue(null as never);
		await activate(state);
		await state.eventHandler.prMergedEvent.emit({
			prUrl: "https://github.com/o/r/pull/1",
			taskMarkedAsCompleted: true,
			sessionId,
		});
		await (state.module as { drain: () => Promise<void> }).drain();

		expect(state.ctx.ui.custom).not.toHaveBeenCalled();
		expect(state.ctx.ui.confirm).not.toHaveBeenCalled();
	});

	it("does not prompt or call capabilities without UI", async () => {
		const state = setup();
		state.ctx.hasUI = false;
		await activate(state);
		await state.eventHandler.prMergedEvent.emit({
			prUrl: "https://github.com/o/r/pull/1",
			taskMarkedAsCompleted: false,
			sessionId,
		});
		await (state.module as { drain: () => Promise<void> }).drain();

		expect(state.ctx.ui.confirm).not.toHaveBeenCalled();
		expect(state.todoist.completeMergedTask).not.toHaveBeenCalled();
		expect(state.worktree.removeWorktree).not.toHaveBeenCalled();
	});

	it("continues with removal confirmation when Todoist capability fails", async () => {
		const state = setup();
		state.sessionState.moduleState.todoist.taskRef = "42";
		state.todoist.completeMergedTask.mockRejectedValue(new Error("failed"));
		await activate(state);
		await state.eventHandler.prMergedEvent.emit({
			prUrl: "https://github.com/o/r/pull/1",
			taskMarkedAsCompleted: false,
			sessionId,
		});
		await (state.module as { drain: () => Promise<void> }).drain();

		expect(state.worktree.removeWorktree).toHaveBeenCalledWith({
			force: false,
		});
	});

	it("suppresses stale worktree confirmation", async () => {
		const state = setup();
		state.ctx.mode = "tui";
		let resolveSelect!: (value: string) => void;
		state.ctx.ui.select = vi.fn(
			() =>
				new Promise<string>((resolve) => {
					resolveSelect = resolve;
				}),
		) as never;
		state.ctx.ui.custom = vi.fn(async () => {
			throw new Error("custom picker must not run");
		}) as never;
		await activate(state);
		await state.eventHandler.prMergedEvent.emit({
			prUrl: "https://github.com/o/r/pull/1",
			taskMarkedAsCompleted: true,
			sessionId,
		});
		await Promise.resolve();
		await state.eventHandler.sessionDeactivatedEvent.emit(undefined);
		resolveSelect("Yes");
		await (state.module as { drain: () => Promise<void> }).drain();

		expect(state.worktree.removeWorktree).not.toHaveBeenCalled();
	});

	it("uses force false when dirty status is clean", async () => {
		const state = setup();
		state.worktree.hasUncommittedChanges.mockResolvedValue(false);
		await activate(state);
		await state.eventHandler.prMergedEvent.emit({
			prUrl: "https://github.com/o/r/pull/1",
			taskMarkedAsCompleted: true,
			sessionId,
		});
		await (state.module as { drain: () => Promise<void> }).drain();

		expect(state.ctx.ui.select).toHaveBeenCalledOnce();
		expect(state.worktree.removeWorktree).toHaveBeenCalledWith({
			force: false,
		});
	});

	it("reports unavailable dirty status as failed cleanup", async () => {
		const state = setup();
		state.worktree.hasUncommittedChanges.mockResolvedValue(null);
		state.worktree.removeWorktree.mockResolvedValue("failed");
		await activate(state);
		await state.eventHandler.prMergedEvent.emit({
			prUrl: "https://github.com/o/r/pull/1",
			taskMarkedAsCompleted: true,
			sessionId,
		});
		await (state.module as { drain: () => Promise<void> }).drain();

		expect(state.ctx.ui.select).toHaveBeenCalledOnce();
		expect(state.worktree.removeWorktree).toHaveBeenCalledWith({
			force: false,
		});
		const cleanupResult = state.worktree.removeWorktree.mock.results[0];
		expect(cleanupResult?.type).toBe("return");
		await expect(cleanupResult?.value).resolves.toBe("failed");
	});
});
