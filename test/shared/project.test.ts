import { describe, expect, it } from "vitest";
import type { CommandResult, Exec } from "../../src/shared/command.ts";
import {
	inspectProject,
	isLinkedWorktreePaths,
	parseBranchName,
	resolveGitPath,
} from "../../src/shared/project.ts";

const ok = (stdout: string): CommandResult => ({ stdout, stderr: "", code: 0 });
const fail = (stderr = "error"): CommandResult => ({
	stdout: "",
	stderr,
	code: 1,
});

function fakeExec(results: Record<string, CommandResult>): Exec {
	return async (command, args) =>
		results[[command, ...args].join(" ")] ??
		fail(`unexpected ${command} ${args.join(" ")}`);
}

describe("shared Git helpers", () => {
	it("normalizes git path output relative to cwd", () => {
		expect(resolveGitPath("/repo/worktree", ".git/worktrees/feature\n")).toBe(
			"/repo/worktree/.git/worktrees/feature",
		);
		expect(resolveGitPath("/repo", "\n")).toBeNull();
	});

	it("parses a non-empty branch name", () => {
		expect(parseBranchName("feature/dialog-editor\n")).toBe(
			"feature/dialog-editor",
		);
		expect(parseBranchName("\n")).toBeNull();
	});

	it("detects linked worktree from git and common directory paths", () => {
		expect(
			isLinkedWorktreePaths(
				"/repo/worktree",
				".git/worktrees/feature",
				"/repo/.git",
			),
		).toBe(true);
		expect(isLinkedWorktreePaths("/repo", "/repo/.git", "/repo/.git")).toBe(
			false,
		);
	});
});

describe("inspectProject", () => {
	it("identifies a linked worktree and branch", async () => {
		const exec = fakeExec({
			"git rev-parse --show-toplevel": ok("/repo/.worktrees/feature\n"),
			"git branch --show-current": ok("feature\n"),
			"git worktree list --porcelain": ok(
				"worktree /repo\nHEAD abc\nbranch refs/heads/main\n\nworktree /repo/.worktrees/feature\nHEAD def\nbranch refs/heads/feature\n",
			),
		});
		await expect(
			inspectProject(exec, "/repo/.worktrees/feature"),
		).resolves.toEqual({
			isWorktree: true,
			root: "/repo/.worktrees/feature",
			branch: "feature",
		});
	});

	it("returns an inert result when a git lookup rejects", async () => {
		const exec: Exec = async () => {
			throw new Error("git unavailable");
		};
		await expect(inspectProject(exec, "/repo")).resolves.toEqual({
			isWorktree: false,
			root: null,
			branch: null,
		});
	});

	it("identifies the main checkout", async () => {
		const exec = fakeExec({
			"git rev-parse --show-toplevel": ok("/repo\n"),
			"git branch --show-current": ok("main\n"),
			"git worktree list --porcelain": ok(
				"worktree /repo\nHEAD abc\nbranch refs/heads/main\n",
			),
		});
		await expect(inspectProject(exec, "/repo")).resolves.toEqual({
			isWorktree: false,
			root: "/repo",
			branch: "main",
		});
	});
});
