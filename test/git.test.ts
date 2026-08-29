import { describe, expect, it } from "vitest";
import {
	type CommandResult,
	type Exec,
	findOpenPr,
	inspectWorktree,
	matchesPinnedPr,
	mergeCommand,
} from "../src/git.ts";

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

describe("inspectWorktree", () => {
	it("identifies a linked worktree and branch", async () => {
		const exec = fakeExec({
			"git rev-parse --show-toplevel": ok("/repo/.worktrees/feature\n"),
			"git branch --show-current": ok("feature\n"),
			"git worktree list --porcelain": ok(
				"worktree /repo\nHEAD abc\nbranch refs/heads/main\n\nworktree /repo/.worktrees/feature\nHEAD def\nbranch refs/heads/feature\n",
			),
		});
		await expect(
			inspectWorktree(exec, "/repo/.worktrees/feature"),
		).resolves.toEqual({
			isWorktree: true,
			root: "/repo/.worktrees/feature",
			branch: "feature",
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
		await expect(inspectWorktree(exec, "/repo")).resolves.toEqual({
			isWorktree: false,
			root: "/repo",
			branch: "main",
		});
	});
});

describe("findOpenPr", () => {
	it("parses the first open pull request", async () => {
		const exec = fakeExec({
			"gh pr list --head feature --state open --json url,state --limit 1": ok(
				'[{"url":"https://github.com/o/r/pull/42","state":"OPEN"}]',
			),
		});
		await expect(findOpenPr(exec, "/repo", "feature")).resolves.toEqual({
			url: "https://github.com/o/r/pull/42",
			state: "OPEN",
		});
	});

	it("returns open with no URL when there is no open pull request", async () => {
		const exec = fakeExec({
			"gh pr list --head feature --state open --json url,state --limit 1":
				ok("[]"),
		});
		await expect(findOpenPr(exec, "/repo", "feature")).resolves.toEqual({
			url: null,
			state: "OPEN",
		});
	});

	it("returns unknown rather than throwing on unavailable gh", async () => {
		await expect(findOpenPr(fakeExec({}), "/repo", "feature")).resolves.toEqual(
			{ url: null, state: "UNKNOWN" },
		);
	});
});

describe("mergeCommand", () => {
	it("parses git and gh merge commands", () => {
		expect(mergeCommand("git merge feature/auth")).toEqual({
			kind: "git",
			args: ["feature/auth"],
		});
		expect(mergeCommand("gh pr merge 42 --squash")).toEqual({
			kind: "gh",
			args: ["42", "--squash"],
		});
	});

	it("handles quoted arguments and chained commands", () => {
		expect(
			mergeCommand('echo "git merge ignored" && git merge "feature/auth"'),
		).toEqual({ kind: "git", args: ["feature/auth"] });
		expect(
			mergeCommand("printf '%s' 'gh pr merge 42'; gh pr merge 43"),
		).toEqual({ kind: "gh", args: ["43"] });
		expect(mergeCommand("git status && printf 'git merge no'")).toBeNull();
		expect(mergeCommand("git merge feature/a; git merge feature/b")).toBeNull();
	});

	it("ignores unrelated commands", () => {
		expect(mergeCommand("git push origin feature/auth")).toBeNull();
		expect(mergeCommand("echo 'gh pr merge 42'")).toBeNull();
	});
});

describe("matchesPinnedPr", () => {
	it("matches a gh merge by pinned URL", async () => {
		const exec = fakeExec({});
		await expect(
			matchesPinnedPr(
				exec,
				"/repo",
				"gh pr merge https://github.com/o/r/pull/42",
				"https://github.com/o/r/pull/42",
			),
		).resolves.toBe(true);
	});

	it("matches a git merge by the pinned PR head branch", async () => {
		const exec = fakeExec({
			"gh pr view https://github.com/o/r/pull/42 --json headRefName": ok(
				'{"headRefName":"feature/auth"}',
			),
		});
		await expect(
			matchesPinnedPr(
				exec,
				"/repo",
				"git merge feature/auth",
				"https://github.com/o/r/pull/42",
			),
		).resolves.toBe(true);
	});

	it("validates gh number and branch targets against the pinned repository", async () => {
		const exec = fakeExec({
			"gh pr view 42 --json url,headRefName": ok(
				'{"url":"https://github.com/o/r/pull/42","headRefName":"feature/auth"}',
			),
			"gh pr view feature/auth --json url,headRefName": ok(
				'{"url":"https://github.com/o/r/pull/42","headRefName":"feature/auth"}',
			),
		});
		await expect(
			matchesPinnedPr(
				exec,
				"/repo",
				"gh pr merge 42",
				"https://github.com/o/r/pull/42",
			),
		).resolves.toBe(true);
		await expect(
			matchesPinnedPr(
				exec,
				"/repo",
				"gh pr merge feature/auth",
				"https://github.com/o/r/pull/42",
			),
		).resolves.toBe(true);

		const otherRepo = fakeExec({
			"gh pr view 42 --json url,headRefName": ok(
				'{"url":"https://github.com/other/repo/pull/42","headRefName":"feature/auth"}',
			),
		});
		await expect(
			matchesPinnedPr(
				otherRepo,
				"/repo",
				"gh pr merge 42",
				"https://github.com/o/r/pull/42",
			),
		).resolves.toBe(false);
	});

	it("rejects ambiguous merge targets", async () => {
		const exec = fakeExec({
			"gh pr view https://github.com/o/r/pull/42 --json headRefName": ok(
				'{"headRefName":"feature/auth"}',
			),
		});
		await expect(
			matchesPinnedPr(
				exec,
				"/repo",
				"git merge feature/auth other",
				"https://github.com/o/r/pull/42",
			),
		).resolves.toBe(false);
	});
});
