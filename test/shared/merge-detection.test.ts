import { describe, expect, it } from "vitest";
import type { CommandResult, Exec } from "../../src/shared/command.ts";
import { detectMerge } from "../../src/shared/merge-detection.ts";

const ok = (stdout: string): CommandResult => ({
	stdout,
	stderr: "",
	code: 0,
});

function fakeExec(results: Record<string, CommandResult>): Exec {
	return async (command, args) =>
		results[[command, ...args].join(" ")] ?? ok("");
}

describe("detectMerge", () => {
	it("returns an event for a pinned PR merge", async () => {
		await expect(
			detectMerge(
				fakeExec({
					"gh pr view https://github.com/o/r/pull/42 --json headRefName": ok(
						'{"headRefName":"feature/auth"}',
					),
				}),
				"/repo",
				'git merge -m "merge message" feature/auth',
				"https://github.com/o/r/pull/42",
			),
		).resolves.toEqual({ prUrl: "https://github.com/o/r/pull/42" });
	});

	it("ignores ambiguous or non-completing merge commands", async () => {
		const exec = fakeExec({
			"gh pr view https://github.com/o/r/pull/42 --json headRefName": ok(
				'{"headRefName":"feature/auth"}',
			),
		});
		await expect(
			detectMerge(
				exec,
				"/repo",
				"git merge feature/auth other",
				"https://github.com/o/r/pull/42",
			),
		).resolves.toBeNull();
		await expect(
			detectMerge(
				exec,
				"/repo",
				"git merge --no-commit feature/auth",
				"https://github.com/o/r/pull/42",
			),
		).resolves.toBeNull();
	});
});
