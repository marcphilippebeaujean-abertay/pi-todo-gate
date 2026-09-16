import { describe, expect, it, vi } from "vitest";
import type { CommandResult } from "../../src/shared/command.ts";
import { createTaskRefreshWorker } from "../../src/todoist/event-publishers.ts";
import {
	parseTaskRefreshResult,
	type TaskRefreshWorkerInput,
} from "../../src/todoist/parsing.ts";

const input: TaskRefreshWorkerInput = {
	sessionId: "session-current",
	cwd: "/repo/.worktrees/feature",
	taskRef: "42",
	taskName: "Implement feature",
	taskDescription: "Old details",
	projectRef: "Pi Extensions",
	prRef: "https://github.com/org/repo/pull/42",
	worktree: {
		isWorktree: true,
		root: "/repo/.worktrees/feature",
		branch: "feature",
	},
};

const result = (stdout: string, code = 0, stderr = ""): CommandResult => ({
	stdout,
	stderr,
	code,
});

const message = (text: string): string =>
	JSON.stringify({
		type: "message_end",
		message: { role: "assistant", content: [{ type: "text", text }] },
	});

describe("Todoist task refresh worker", () => {
	it("runs isolated refresh worker with current task context", async () => {
		const exec = vi.fn(
			async (
				command: string,
				args: readonly string[],
				options?: { timeout?: number },
			) => {
				expect(command).toBe("pi");
				expect(options?.timeout).toBe(120_000);
				expect(args).toEqual(
					expect.arrayContaining([
						"--mode",
						"json",
						"--no-extensions",
						"--no-context-files",
						"--tools",
						"bash",
						"--thinking",
						"high",
					]),
				);
				const prompt = args.at(-1) ?? "";
				expect(prompt).toContain("refresh");
				expect(prompt).toContain(input.taskRef);
				expect(prompt).toContain(input.taskName);
				expect(prompt).toContain(input.taskDescription);
				expect(prompt).toContain(input.sessionId);
				expect(prompt).toContain(input.projectRef);
				expect(prompt).toContain(input.prRef);
				return result(
					message(
						'{"newTaskDescription":"Updated details","newTaskName":"Updated feature","hasCompletedTask":false}',
					),
				);
			},
		);

		await expect(createTaskRefreshWorker(exec)(input)).resolves.toEqual({
			newTaskDescription: "Updated details",
			newTaskName: "Updated feature",
			hasCompletedTask: false,
		});
	});

	it("accepts only the typed refresh response", () => {
		expect(
			parseTaskRefreshResult(
				message(
					'{"newTaskDescription":null,"newTaskName":null,"hasCompletedTask":true}',
				),
			),
		).toEqual({
			newTaskDescription: null,
			newTaskName: null,
			hasCompletedTask: true,
		});
		expect(parseTaskRefreshResult(message('{"newTaskName":"Updated"}'))).toBe(
			undefined,
		);
	});
});
