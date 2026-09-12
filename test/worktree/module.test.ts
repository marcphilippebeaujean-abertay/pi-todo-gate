import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import type { CommandResult, Exec } from "../../src/shared/command.ts";
import { createSharedEvents } from "../../src/shared/events.ts";
import { createWorktreeModule } from "../../src/worktree/module.ts";

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
		const module = createWorktreeModule(events, { exec });
		const sharedContext = context();
		const firstStart = module.sessionStart(sharedContext);
		await Promise.resolve();
		const secondStart = module.sessionStart(sharedContext);
		await secondStart;
		releaseFirstInspection();
		await firstStart;

		expect(module.getWorktreeInfo()).toEqual({
			worktreePath: "/repo/.worktrees/feature",
			branch: "later",
		});
	});

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
		await expect(module.removeWorktree()).resolves.toBe("completed");
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
});
