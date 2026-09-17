import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import type { CommandResult, Exec } from "../../src/shared/command.ts";
import { createSharedEvents } from "../../src/shared/events.ts";
import { createSessionState } from "../../src/state.ts";
import { createWorktreeModule } from "../../src/worktree/module.ts";
import { worktreeStateDescriptor } from "../../src/worktree/module-state.ts";

type TestWorktreeModule = {
	sessionStart(context: ExtensionContext, sessionId: string): Promise<void>;
	deactivate(): void;
	getWorktreeInfo(): { worktreePath: string; branch: string } | null;
	hasUncommittedChanges(): Promise<boolean | null>;
	removeWorktree(options: { force: boolean }): Promise<unknown>;
};

const createTestWorktreeModule = (
	options: Parameters<typeof createWorktreeModule>[0],
): TestWorktreeModule =>
	createWorktreeModule({
		...options,
		changeDirectory:
			options.changeDirectory ??
			options.dependencies?.changeDirectory ??
			vi.fn(),
	}) as unknown as TestWorktreeModule;

function ok(stdout: string): CommandResult {
	return { stdout, stderr: "", code: 0 };
}

function projectResult(
	initialHead: string,
	currentHead: string,
	initialStatus: string,
	currentStatus: string,
	commands: Array<{ command: string; args: string[]; cwd?: string }>,
): Exec {
	return async (command, args, options) => {
		commands.push({ command, args, cwd: options?.cwd });
		const key = [command, ...args].join(" ");
		if (key === "git rev-parse --show-toplevel")
			return ok("/repo/.worktrees/feature\n");
		if (key === "git branch --show-current") return ok("feature\n");
		if (key === "git worktree list --porcelain")
			return ok(
				"worktree /repo\nHEAD abc\nbranch refs/heads/main\n\nworktree /repo/.worktrees/feature\nHEAD def\nbranch refs/heads/feature\n",
			);
		if (key === "git rev-parse HEAD")
			return ok(
				`${commands.filter(({ args }) => args.join(" ") === "rev-parse HEAD").length === 1 ? initialHead : currentHead}\n`,
			);
		if (key === "git status --porcelain=v1 --untracked-files=all")
			return ok(
				commands.filter(
					({ args }) =>
						args.join(" ") === "status --porcelain=v1 --untracked-files=all",
				).length === 1
					? initialStatus
					: currentStatus,
			);
		return ok("");
	};
}

function context(cwd = "/repo/.worktrees/feature") {
	return {
		cwd,
		hasUI: true,
		ui: {
			confirm: vi.fn(async () => true),
			notify: vi.fn(),
		},
	} as unknown as ExtensionContext;
}

describe("worktree state", () => {
	it("provides common session-state descriptor", () => {
		const state = { initialHead: "abc", initialStatus: "" };
		expect(worktreeStateDescriptor.id).toBe("worktree");
		expect(
			worktreeStateDescriptor.restore(worktreeStateDescriptor.serialize(state)),
		).toEqual(state);
	});
});

describe("worktree event actions", () => {
	it("reports current dirty status without prompting", async () => {
		const events = createSharedEvents();
		const sessionState = createSessionState();
		sessionState.session.activeSessionId = "session";
		const ctx = context();
		const exec: Exec = async (command, args) => {
			const key = [command, ...args].join(" ");
			if (key === "git status --porcelain=v1 --untracked-files=all")
				return ok(" M dirty\\n");
			return ok("");
		};
		const module = createTestWorktreeModule({
			eventHandler: events,
			sessionState,
			dependencies: { exec },
		});
		await module.sessionStart(ctx, "session");

		await expect(module.hasUncommittedChanges()).resolves.toBe(true);
		expect(ctx.ui.confirm).not.toHaveBeenCalled();
	});

	it("returns null when dirty status resolves after session changes", async () => {
		const events = createSharedEvents();
		const sessionState = createSessionState();
		sessionState.session.activeSessionId = "session";
		const commands: Array<{ command: string; args: string[]; cwd?: string }> =
			[];
		let statusCalls = 0;
		let releaseStatus!: () => void;
		const statusBlocked = new Promise<void>((resolve) => {
			releaseStatus = resolve;
		});
		const exec: Exec = async (command, args, options) => {
			commands.push({ command, args, cwd: options?.cwd });
			const key = [command, ...args].join(" ");
			if (key === "git rev-parse --show-toplevel")
				return ok("/repo/.worktrees/feature\\n");
			if (key === "git branch --show-current") return ok("feature\\n");
			if (key === "git worktree list --porcelain")
				return ok("worktree /repo\\nHEAD abc\\nbranch refs/heads/main\\n");
			if (key === "git rev-parse HEAD") return ok("def\\n");
			if (key === "git status --porcelain=v1 --untracked-files=all") {
				statusCalls += 1;
				if (statusCalls === 2) await statusBlocked;
				return ok(statusCalls === 1 ? "" : " M stale\\n");
			}
			return ok("");
		};
		const ctx = context();
		const module = createTestWorktreeModule({
			eventHandler: events,
			sessionState,
			dependencies: { exec },
		});
		await module.sessionStart(ctx, "session");

		const dirtyStatus = module.hasUncommittedChanges();
		await Promise.resolve();
		sessionState.session.activeSessionId = "new-session";
		releaseStatus();

		await expect(dirtyStatus).resolves.toBeNull();
	});

	it("returns null when dirty status is unavailable", async () => {
		const events = createSharedEvents();
		const sessionState = createSessionState();
		sessionState.session.activeSessionId = "session";
		const ctx = context();
		const exec: Exec = async (command, args) => {
			const key = [command, ...args].join(" ");
			if (key === "git rev-parse --show-toplevel")
				return ok("/repo/.worktrees/feature\\n");
			if (key === "git branch --show-current") return ok("feature\\n");
			if (key === "git worktree list --porcelain")
				return ok("worktree /repo\\nHEAD abc\\nbranch refs/heads/main\\n");
			if (key === "git rev-parse HEAD") return ok("def\\n");
			if (key === "git status --porcelain=v1 --untracked-files=all")
				return { stdout: "", stderr: "unavailable", code: 1 };
			return ok("");
		};
		const module = createTestWorktreeModule({
			eventHandler: events,
			sessionState,
			dependencies: { exec },
		});
		await module.sessionStart(ctx, "session");

		await expect(module.hasUncommittedChanges()).resolves.toBeNull();
		expect(ctx.ui.confirm).not.toHaveBeenCalled();
	});

	it("does not remove dirty worktree without force", async () => {
		const events = createSharedEvents();
		const commands: Array<{ command: string; args: string[]; cwd?: string }> =
			[];
		const sessionState = createSessionState();
		sessionState.session.activeSessionId = "session";
		const ctx = context();
		const module = createTestWorktreeModule({
			eventHandler: events,
			sessionState,
			dependencies: {
				exec: projectResult("abc", "abc", "", " M dirty\\n", commands),
			},
		});
		await module.sessionStart(ctx, "session");

		await expect(module.removeWorktree({ force: false })).resolves.toBe(
			"failed",
		);
		expect(ctx.ui.confirm).not.toHaveBeenCalled();
		expect(
			commands.some(
				({ args }) => args[0] === "worktree" && args[1] === "remove",
			),
		).toBe(false);
	});

	it("does not let an earlier start overwrite a later start", async () => {
		const events = createSharedEvents();
		let releaseFirstInspection!: () => void;
		const firstInspectionReleased = new Promise<void>((resolve) => {
			releaseFirstInspection = resolve;
		});
		let remoteCalls = 0;
		let branchCalls = 0;
		const exec: Exec = async (command, args) => {
			const key = [command, ...args].join(" ");
			if (key === "git remote get-url origin") {
				remoteCalls += 1;
				if (remoteCalls === 1) await firstInspectionReleased;
				return ok("origin");
			}
			if (key === "git rev-parse --show-toplevel")
				return ok("/repo/.worktrees/feature\n");
			if (key === "git branch --show-current") {
				branchCalls += 1;
				return ok(branchCalls === 1 ? "later\n" : "earlier\n");
			}
			if (key === "git worktree list --porcelain")
				return ok(
					"worktree /repo\nHEAD abc\nbranch refs/heads/main\n\nworktree /repo/.worktrees/feature\nHEAD def\nbranch refs/heads/feature\n",
				);
			if (key === "git rev-parse HEAD") return ok("def\n");
			if (key === "git status --porcelain=v1 --untracked-files=all")
				return ok("\n");
			return ok("");
		};
		const sessionState = createSessionState();
		sessionState.session.activeSessionId = "session";
		const module = createTestWorktreeModule({
			eventHandler: events,
			sessionState,
			dependencies: { exec },
		});
		const sharedContext = context();
		const firstStart = module.sessionStart(sharedContext, "session");
		await Promise.resolve();
		const secondStart = module.sessionStart(sharedContext, "session");
		await secondStart;
		releaseFirstInspection();
		await firstStart;

		expect(module.getWorktreeInfo()).toEqual({
			worktreePath: "/repo/.worktrees/feature",
			branch: "later",
		});
	});

	it("changes directory to main root after loading worktree", async () => {
		const events = createSharedEvents();
		const sessionState = createSessionState();
		sessionState.session.activeSessionId = "session";
		const changeDirectoryToRoot = vi.fn();
		const module = createTestWorktreeModule({
			eventHandler: events,
			sessionState,
			exec: projectResult("abc", "def", "", "", []),
			changeDirectoryToRoot,
		});

		await module.sessionStart(context(), "session");

		expect(changeDirectoryToRoot).toHaveBeenCalledWith("/repo");
	});

	it("starts from shared session-activated event", async () => {
		const events = createSharedEvents();
		const commands: Array<{
			command: string;
			args: string[];
			cwd?: string;
		}> = [];
		const sessionState = createSessionState();
		sessionState.session.activeSessionId = "session";
		const module = createTestWorktreeModule({
			eventHandler: events,
			sessionState,
			exec: projectResult("abc", "def", "", "", commands),
		});

		await events.sessionActivatedEvent.emit({
			context: context(),
			sessionId: "session",
		});

		expect(module.getWorktreeInfo()).toEqual({
			worktreePath: "/repo/.worktrees/feature",
			branch: "feature",
		});
	});

	it("preserves new baseline after delayed stale activation", async () => {
		const events = createSharedEvents();
		const sessionState = createSessionState();
		sessionState.session.activeSessionId = "new";
		const ctx = context();
		const module = createTestWorktreeModule({
			eventHandler: events,
			sessionState,
			exec: projectResult("abc", "def", "", "", []),
		});

		await module.sessionStart(ctx, "new");
		await module.sessionStart(ctx, "old");

		expect(module.getWorktreeInfo()).toEqual({
			worktreePath: "/repo/.worktrees/feature",
			branch: "feature",
		});
	});

	it("publishes exact reset payload on deactivate", () => {
		const events = createSharedEvents();
		const updates: unknown[] = [];
		events.moduleStateChangedEvent.subscribe((update) => {
			updates.push(update);
		});
		const module = createTestWorktreeModule({
			eventHandler: events,
			sessionState: createSessionState(),
		});

		module.deactivate();

		expect(updates).toEqual([
			{
				moduleId: "worktree",
				moduleState: {},
				persist: false,
				gitStatePatch: {},
			},
		]);
	});

	it("owns tool-result status refresh and emits typed updates", async () => {
		const events = createSharedEvents();
		const sessionState = createSessionState();
		sessionState.session.activeSessionId = "session";
		const updates: unknown[] = [];
		events.moduleStateChangedEvent.subscribe((update) => {
			updates.push(update);
		});
		let dirty = false;
		const exec: Exec = async (command, args) => {
			const key = [command, ...args].join(" ");
			if (key === "git rev-parse --show-toplevel")
				return ok("/repo/.worktrees/feature\n");
			if (key === "git branch --show-current") return ok("feature\n");
			if (key === "git worktree list --porcelain")
				return ok("worktree /repo\nHEAD abc\nbranch refs/heads/main\n");
			if (key === "git rev-parse HEAD") return ok("def\n");
			if (key === "git status --porcelain=v1 --untracked-files=all")
				return ok(dirty ? " M file\n" : "");
			return ok("origin\n");
		};
		const ctx = context();
		const module = createTestWorktreeModule({
			eventHandler: events,
			sessionState,
			dependencies: { exec },
		});
		await module.sessionStart(ctx, "session");
		dirty = true;
		await events.toolResultEvent.emit({
			event: { toolName: "edit", isError: false } as never,
			context: ctx,
		});
		expect(updates.at(-1)).toMatchObject({
			moduleId: "worktree",
			gitStatePatch: { hasUncommittedChanges: true },
		});
	});

	it("ignores stale concurrent status refresh results", async () => {
		const events = createSharedEvents();
		const sessionState = createSessionState();
		sessionState.session.activeSessionId = "session";
		const moduleUpdates: Array<{
			gitStatePatch?: { hasUncommittedChanges?: boolean };
		}> = [];
		events.moduleStateChangedEvent.subscribe((update) => {
			moduleUpdates.push({ gitStatePatch: update.gitStatePatch });
		});
		let statusCalls = 0;
		let releaseFirstRefresh!: () => void;
		const firstRefreshBlocked = new Promise<void>((resolve) => {
			releaseFirstRefresh = resolve;
		});
		const exec: Exec = async (command, args) => {
			const key = [command, ...args].join(" ");
			if (key === "git rev-parse --show-toplevel")
				return ok("/repo/.worktrees/feature\n");
			if (key === "git branch --show-current") return ok("feature\n");
			if (key === "git worktree list --porcelain")
				return ok("worktree /repo\nHEAD abc\nbranch refs/heads/main\n");
			if (key === "git rev-parse HEAD") return ok("def\n");
			if (key === "git status --porcelain=v1 --untracked-files=all") {
				statusCalls += 1;
				if (statusCalls === 2) await firstRefreshBlocked;
				return ok(statusCalls === 2 ? " M stale\n" : "");
			}
			return ok("origin\n");
		};
		const ctx = context();
		const module = createTestWorktreeModule({
			eventHandler: events,
			sessionState,
			dependencies: { exec },
		});
		await module.sessionStart(ctx, "session");

		const first = events.toolResultEvent.emit({
			event: { toolName: "bash", isError: false } as never,
			context: ctx,
		});
		await Promise.resolve();
		const second = events.toolResultEvent.emit({
			event: { toolName: "bash", isError: false } as never,
			context: ctx,
		});
		releaseFirstRefresh();
		await Promise.all([first, second]);

		expect(moduleUpdates.at(-1)?.gitStatePatch?.hasUncommittedChanges).toBe(
			false,
		);
		expect(
			moduleUpdates.filter(
				(update) => update.gitStatePatch?.hasUncommittedChanges,
			).length,
		).toBe(0);
	});

	it("executes cleanup immediately after a merge", async () => {
		const events = createSharedEvents();
		const commands: Array<{ command: string; args: string[]; cwd?: string }> =
			[];
		const changeDirectory = vi.fn();
		const sessionState = createSessionState();
		sessionState.session.activeSessionId = "session";
		const ctx = context();
		const module = createTestWorktreeModule({
			eventHandler: events,
			sessionState,
			dependencies: {
				exec: projectResult("abc", "abc", "", " M dirty\\n", commands),
				changeDirectory,
			},
		});
		await module.sessionStart(ctx, "session");
		await expect(module.removeWorktree({ force: true })).resolves.toBe(
			"completed",
		);
		expect(ctx.ui.confirm).not.toHaveBeenCalled();
		expect(changeDirectory).toHaveBeenCalledWith("/repo");
		expect(commands.at(-2)).toEqual({
			command: "git",
			args: ["worktree", "remove", "--force", "/repo/.worktrees/feature"],
			cwd: "/repo",
		});
		expect(commands.at(-1)).toEqual({
			command: "git",
			args: ["branch", "-D", "feature"],
			cwd: "/repo",
		});
	});

	it("rejects blocked cleanup after a new session starts", async () => {
		const events = createSharedEvents();
		const sessionState = createSessionState();
		sessionState.session.activeSessionId = "old";
		let releaseConfirm!: () => void;
		const confirmBlocked = new Promise<void>((resolve) => {
			releaseConfirm = resolve;
		});
		const ctx = context();
		const commands: Array<{ command: string; args: string[]; cwd?: string }> =
			[];
		const changeDirectory = vi.fn();
		const confirm = vi.fn(async () => {
			await confirmBlocked;
			return true;
		});
		(ctx.ui as unknown as { confirm: typeof confirm }).confirm = confirm;
		const module = createTestWorktreeModule({
			eventHandler: events,
			sessionState,
			dependencies: {
				exec: projectResult("abc", "abc", "", " M dirty\\n", commands),
				changeDirectory,
			},
		});
		await module.sessionStart(ctx, "old");
		const cleanup = module.removeWorktree({ force: false });
		await Promise.resolve();
		sessionState.session.activeSessionId = "new";
		await module.sessionStart(ctx, "new");
		releaseConfirm();

		expect(await cleanup).toBe("failed");
		expect(module.getWorktreeInfo()).not.toBeNull();
		expect(
			commands.filter(
				({ args }) =>
					(args[0] === "worktree" && args[1] === "remove") ||
					(args[0] === "branch" && args[1] === "-D"),
			),
		).toEqual([]);
		expect(changeDirectory).not.toHaveBeenCalled();
		expect(ctx.ui.notify).not.toHaveBeenCalled();
	});
});
