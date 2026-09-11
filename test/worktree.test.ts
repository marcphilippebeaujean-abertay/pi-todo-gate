import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import type { ExitAction } from "../src/exit-protocol/types.ts";
import type { CommandResult, Exec } from "../src/shared/command.ts";
import { createSharedEvents } from "../src/shared/events.ts";
import { createWorktreeModule } from "../src/worktree/module.ts";

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

	it("requires confirmation before removing dirty worktree after a merge", async () => {
		const events = createSharedEvents();
		const commands: Array<{ command: string; args: string[]; cwd?: string }> =
			[];
		const ctx = context();
		(ctx.ui.confirm as ReturnType<typeof vi.fn>).mockResolvedValue(false);
		const module = createWorktreeModule(events, {
			exec: projectResult("abc", "abc", "", " M file.ts", commands),
		});
		await module.sessionStart(ctx);
		let mergeAction: ExitAction | undefined;
		events.on(
			"prMerged",
			(request) => {
				mergeAction = request.actions[0];
			},
			"present",
		);

		await events.emit("prMerged", {
			prUrl: "pr",
			taskMarkedAsCompleted: false,
		});
		await expect(mergeAction?.execute()).resolves.toBe("failed");

		expect(ctx.ui.confirm).toHaveBeenCalledOnce();
		expect(
			commands.some(
				({ args }) => args[0] === "worktree" && args[1] === "remove",
			),
		).toBe(false);
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
		events.on(
			"prMerged",
			(request) => {
				mergeAction = request.actions[0];
			},
			"present",
		);
		await events.emit("prMerged", {
			prUrl: "pr",
			taskMarkedAsCompleted: false,
		});
		await expect(mergeAction?.execute()).resolves.toBe("failed");

		expect(
			commands.filter(
				({ args }) => args[0] === "worktree" && args[1] === "remove",
			),
		).toHaveLength(1);
		expect(
			commands.filter(({ args }) => args[0] === "branch" && args[1] === "-D"),
		).toHaveLength(1);
	});
});
