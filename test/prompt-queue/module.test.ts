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
		hasUncommittedChanges: vi.fn(async () => false),
		removeWorktree: vi.fn(async () => "completed" as const),
	};
	const api = pi();
	const module = createPromptQueueModule({
		pi: api,
		eventHandler,
		sessionState,
		pr,
		todoist,
		worktree,
		queue: new PromptQueue(),
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
		await state.api.commands.get("merge")?.handler("", state.ctx);

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
		await state.api.commands.get("merge")?.handler("", state.ctx);

		expect(state.pr.mergeActivePr).not.toHaveBeenCalled();
	});

	it("synchronously queues Todoist completion before exit picker", async () => {
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
		state.worktree.hasUncommittedChanges.mockResolvedValue(true);
		state.sessionState.moduleState.todoist.taskRef = undefined;
		await activate(state);
		await state.eventHandler.prMergedEvent.emit({
			prUrl: "https://github.com/o/r/pull/1",
			taskMarkedAsCompleted: false,
			sessionId,
		});
		await (state.module as { drain?: () => Promise<void> }).drain?.();

		expect(state.worktree.removeWorktree).toHaveBeenCalledWith({ force: true });
	});

	it("runs exit picker after cancelled Todoist confirmation", async () => {
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
});
