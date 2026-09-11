import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import type { ExitAction } from "../src/exit-protocol/types.ts";
import type { CommandResult, Exec } from "../src/shared/command.ts";
import { createSharedEvents } from "../src/shared/events.ts";
import {
	createWorktreeModule,
	hasNoSessionWork,
} from "../src/worktree/module.ts";

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

describe("worktree session baseline", () => {
	it("detects clean unchanged worktree as no work", () => {
		expect(
			hasNoSessionWork(
				{ initialHead: "abc", initialStatus: "" },
				{ currentHead: "abc", currentStatus: "" },
			),
		).toBe(true);
	});

	it("treats a new commit as work", () => {
		expect(
			hasNoSessionWork(
				{ initialHead: "abc", initialStatus: "" },
				{ currentHead: "def", currentStatus: "" },
			),
		).toBe(false);
	});

	it.each(["?? new.txt", " M file.ts", "M  staged.ts"])(
		"treats status %s as work",
		(initialStatus) => {
			expect(
				hasNoSessionWork(
					{ initialHead: "abc", initialStatus: "" },
					{ currentHead: "abc", currentStatus: initialStatus },
				),
			).toBe(false);
		},
	);

	it("treats an initially dirty worktree as work even after cleanup", () => {
		expect(
			hasNoSessionWork(
				{ initialHead: "abc", initialStatus: " M file.ts" },
				{ currentHead: "abc", currentStatus: "" },
			),
		).toBe(false);
	});
});

describe("worktree event actions", () => {
	it("executes cleanup immediately after a merge", async () => {
		const events = createSharedEvents();
		const commands: Array<{ command: string; args: string[]; cwd?: string }> =
			[];
		const changeDirectory = vi.fn();
		const module = createWorktreeModule(events, {
			exec: projectResult("abc", "abc", "", "", commands),
			changeDirectory,
		});
		await module.sessionStart(context());
		let mergeAction: ExitAction | undefined;
		events.on(
			"prMerged",
			(request) => {
				mergeAction = request.actions[0];
			},
			"present",
		);

		const payload = { prUrl: "pr", taskMarkedAsCompleted: false };
		await events.emit("prMerged", payload);

		expect(mergeAction?.id).toBe("remove-worktree");
		expect(payload.taskMarkedAsCompleted).toBe(false);
		await expect(mergeAction?.execute()).resolves.toBe("completed");
		expect(changeDirectory).toHaveBeenCalledWith("/repo");
		expect(commands.at(-2)).toEqual({
			command: "git",
			args: ["worktree", "remove", "/repo/.worktrees/feature"],
			cwd: "/repo",
		});
		expect(commands.at(-1)).toEqual({
			command: "git",
			args: ["branch", "-D", "feature"],
			cwd: "/repo",
		});
	});

	it("keeps quit cleanup available when merged cleanup is unselected", async () => {
		const events = createSharedEvents();
		const commands: Array<{ command: string; args: string[]; cwd?: string }> =
			[];
		const changeDirectory = vi.fn();
		const module = createWorktreeModule(events, {
			exec: projectResult("abc", "def", "", "", commands),
			changeDirectory,
		});
		await module.sessionStart(context());
		let mergeAction: ExitAction | undefined;
		let quitAction: ExitAction | undefined;
		events.on(
			"prMerged",
			(request) => {
				mergeAction = request.actions[0];
			},
			"present",
		);
		events.on(
			"sessionWillClose",
			(request) => {
				quitAction = request.actions[0];
			},
			"present",
		);

		await events.emit("prMerged", {
			prUrl: "pr",
			taskMarkedAsCompleted: false,
		});
		await events.emit("sessionWillClose", { reason: "quit" });

		expect(mergeAction?.id).toBe("remove-worktree");
		expect(quitAction?.id).toBe("remove-worktree");
		await expect(quitAction?.execute()).resolves.toBe("completed");
		expect(changeDirectory).toHaveBeenCalledWith("/repo");
		expect(commands.at(-2)).toEqual({
			command: "git",
			args: ["worktree", "remove", "/repo/.worktrees/feature"],
			cwd: "/repo",
		});
		expect(commands.at(-1)).toEqual({
			command: "git",
			args: ["branch", "-D", "feature"],
			cwd: "/repo",
		});
	});

	it.each(["new", "resume", "fork", "reload"] as const)(
		"does not add cleanup action for %s shutdown",
		async (reason) => {
			const events = createSharedEvents();
			const commands: Array<{ command: string; args: string[]; cwd?: string }> =
				[];
			const module = createWorktreeModule(events, {
				exec: projectResult("abc", "abc", "", "", commands),
			});
			await module.sessionStart(context());
			let actions = 0;
			events.on(
				"sessionWillClose",
				(request) => {
					actions += request.actions.length;
				},
				"present",
			);

			await events.emit("sessionWillClose", { reason });

			expect(actions).toBe(0);
			expect(
				commands.filter(
					({ args }) => args[0] === "worktree" && args[1] === "remove",
				),
			).toEqual([]);
		},
	);

	it("adds cleanup action for changed worktree at quit", async () => {
		const events = createSharedEvents();
		const commands: Array<{ command: string; args: string[]; cwd?: string }> =
			[];
		const changeDirectory = vi.fn();
		const module = createWorktreeModule(events, {
			exec: projectResult("abc", "def", "", "", commands),
			changeDirectory,
		});
		await module.sessionStart(context());
		const actions: ExitAction[] = [];
		events.on(
			"sessionWillClose",
			(request) => {
				actions.push(...request.actions);
			},
			"present",
		);

		await events.emit("sessionWillClose", { reason: "quit" });

		expect(actions.map((action) => action.id)).toEqual(["remove-worktree"]);
		await expect(actions[0]?.execute()).resolves.toBe("completed");
		expect(commands.at(-2)).toEqual({
			command: "git",
			args: ["worktree", "remove", "/repo/.worktrees/feature"],
			cwd: "/repo",
		});
		expect(commands.at(-1)).toEqual({
			command: "git",
			args: ["branch", "-D", "feature"],
			cwd: "/repo",
		});
	});

	it("auto-deletes clean unchanged worktree without cleanup action", async () => {
		const events = createSharedEvents();
		const commands: Array<{ command: string; args: string[]; cwd?: string }> =
			[];
		const changeDirectory = vi.fn();
		const ctx = context();
		const module = createWorktreeModule(events, {
			exec: projectResult("abc", "abc", "", "", commands),
			changeDirectory,
		});
		await module.sessionStart(ctx);
		const actions: ExitAction[] = [];
		events.on(
			"sessionWillClose",
			(request) => {
				actions.push(...request.actions);
			},
			"present",
		);

		await events.emit("sessionWillClose", { reason: "quit" });

		expect(actions).toEqual([]);
		expect(changeDirectory).toHaveBeenCalledWith("/repo");
		expect(ctx.ui.notify).toHaveBeenCalledWith(
			"Worktree deleted because no changes were made",
			"info",
		);
	});

	it("does not retry cleanup after branch deletion fails", async () => {
		const events = createSharedEvents();
		const commands: Array<{ command: string; args: string[]; cwd?: string }> =
			[];
		const changeDirectory = vi.fn();
		const baseExec = projectResult("abc", "def", "", "", commands);
		const exec = async (
			command: string,
			args: string[],
			options?: { cwd?: string },
		) => {
			const result = await baseExec(command, args, options);
			const isBranchDelete =
				command === "git" && args[0] === "branch" && args[1] === "-D";
			if (isBranchDelete)
				return { stdout: "", stderr: "branch locked", code: 1 };
			return result;
		};
		const module = createWorktreeModule(events, { exec, changeDirectory });
		await module.sessionStart(context());
		let mergeAction: ExitAction | undefined;
		let quitActions = 0;
		events.on(
			"prMerged",
			(request) => {
				mergeAction = request.actions[0];
			},
			"present",
		);
		events.on(
			"sessionWillClose",
			(request) => {
				quitActions = request.actions.length;
			},
			"present",
		);

		await events.emit("prMerged", {
			prUrl: "pr",
			taskMarkedAsCompleted: false,
		});
		await expect(mergeAction?.execute()).resolves.toBe("failed");
		await events.emit("sessionWillClose", { reason: "quit" });

		expect(quitActions).toBe(0);
		expect(
			commands.filter(
				({ args }) => args[0] === "worktree" && args[1] === "remove",
			),
		).toHaveLength(1);
		expect(
			commands.filter(({ args }) => args[0] === "branch" && args[1] === "-D"),
		).toHaveLength(1);
	});

	it("does not offer a second cleanup after automatic cleanup partially fails", async () => {
		const events = createSharedEvents();
		const commands: Array<{ command: string; args: string[]; cwd?: string }> =
			[];
		const changeDirectory = vi.fn();
		const baseExec = projectResult("abc", "abc", "", "", commands);
		const exec = async (
			command: string,
			args: string[],
			options?: { cwd?: string },
		) => {
			const result = await baseExec(command, args, options);
			const isBranchDelete =
				command === "git" && args[0] === "branch" && args[1] === "-D";
			if (isBranchDelete)
				return { stdout: "", stderr: "branch locked", code: 1 };
			return result;
		};
		const module = createWorktreeModule(events, { exec, changeDirectory });
		await module.sessionStart(context());
		let actions: readonly ExitAction[] | undefined;
		events.on(
			"sessionWillClose",
			(request) => {
				actions = request.actions;
			},
			"present",
		);

		await events.emit("sessionWillClose", { reason: "quit" });

		expect(actions).toEqual([]);
		expect(
			commands.filter(({ args }) => args[0] === "branch" && args[1] === "-D"),
		).toHaveLength(1);
	});

	it("notifies when Git worktree state is unavailable", async () => {
		const events = createSharedEvents();
		const commands: Array<{ command: string; args: string[]; cwd?: string }> =
			[];
		let statusCalls = 0;
		const baseExec = projectResult("abc", "def", "", "", commands);
		const exec = async (
			command: string,
			args: string[],
			options?: { cwd?: string },
		) => {
			const result = await baseExec(command, args, options);
			const isStatus = command === "git" && args[0] === "status";
			statusCalls += Number(isStatus);
			if (isStatus && statusCalls > 1)
				return { stdout: "", stderr: "status unavailable", code: 1 };
			return result;
		};
		const ctx = context();
		const module = createWorktreeModule(events, { exec });
		await module.sessionStart(ctx);
		let action: ExitAction | undefined;
		events.on(
			"sessionWillClose",
			(request) => {
				action = request.actions[0];
			},
			"present",
		);

		await events.emit("sessionWillClose", { reason: "quit" });
		await expect(action?.execute()).resolves.toBe("failed");

		expect(ctx.ui.notify).toHaveBeenCalledWith(
			"Worktree cleanup failed: Git status unavailable",
			"warning",
		);
	});

	it("requires confirmation before removing dirty worktree", async () => {
		const events = createSharedEvents();
		const commands: Array<{ command: string; args: string[]; cwd?: string }> =
			[];
		const ctx = context();
		(ctx.ui.confirm as ReturnType<typeof vi.fn>).mockResolvedValue(false);
		const module = createWorktreeModule(events, {
			exec: projectResult("abc", "abc", "", " M file.ts", commands),
		});
		await module.sessionStart(ctx);
		let action: ExitAction | undefined;
		events.on(
			"sessionWillClose",
			(request) => {
				action = request.actions[0];
			},
			"present",
		);

		await events.emit("sessionWillClose", { reason: "quit" });
		await expect(action?.execute()).resolves.toBe("failed");

		expect(ctx.ui.confirm).toHaveBeenCalledOnce();
		expect(
			commands.some(
				({ args }) => args[0] === "worktree" && args[1] === "remove",
			),
		).toBe(false);
	});
});
