import { describe, expect, it, vi } from "vitest";
import type { CommandResult } from "../../src/shared/command.ts";
import {
	createTaskClaimWorker,
	type TaskClaimWorkerInput,
	TaskClaimWorkerInputSchema,
	TaskClaimWorkerResultSchema,
} from "../../src/todoist/claim-worker.ts";

const input: TaskClaimWorkerInput = {
	prompt: "Implement feature",
	history: ["initial user request", "assistant response"],
	cwd: "/repo/.worktrees/feature",
	projectRef: "Pi Extensions",
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

describe("Todoist task claim worker", () => {
	it("runs isolated pi process with claim input and parses result", async () => {
		const exec = vi.fn(
			async (
				command: string,
				args: readonly string[],
				options?: { timeout?: number },
			) => {
				expect(command).toBe("pi");
				expect(options?.timeout).toBe(30_000);
				expect(args).toEqual(
					expect.arrayContaining([
						"--mode",
						"json",
						"--no-session",
						"--no-extensions",
						"--no-context-files",
						"--tools",
						"bash",
					]),
				);
				const prompt = args.at(-1) ?? "";
				expect(prompt).toContain("Input payload matching this schema:");
				expect(prompt).toContain(JSON.stringify(TaskClaimWorkerInputSchema));
				expect(prompt).toContain("Output JSON matching this schema:");
				expect(prompt).toContain(JSON.stringify(TaskClaimWorkerResultSchema));
				expect(prompt).toContain(input.prompt);
				expect(prompt).toContain(input.projectRef);
				expect(prompt).toContain(input.worktree.branch ?? "");
				return result(
					JSON.stringify({
						type: "message_end",
						message: {
							role: "assistant",
							content: [
								{ type: "text", text: '{"status":"claimed","taskRef":"42"}' },
							],
						},
					}),
				);
			},
		);

		await expect(createTaskClaimWorker(exec)(input)).resolves.toEqual({
			status: "claimed",
			taskRef: "42",
		});
	});

	it("redacts bearer credentials from worker failure details", async () => {
		const exec = async (): Promise<CommandResult> =>
			result("", 1, "provider unavailable Authorization: Bearer secret");
		await expect(createTaskClaimWorker(exec)(input)).rejects.toThrow(
			"claim worker exited with code 1: provider unavailable Authorization: Bearer [redacted]",
		);
	});

	it("returns none for malformed worker output", async () => {
		const exec = async (): Promise<CommandResult> => result("not json");
		await expect(createTaskClaimWorker(exec)(input)).resolves.toEqual({
			status: "none",
		});
	});
});
