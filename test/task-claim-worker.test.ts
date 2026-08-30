import { describe, expect, it, vi } from "vitest";
import type { CommandResult } from "../src/git.ts";
import {
	createTaskClaimWorker,
	type TaskClaimWorkerInput,
} from "../src/task-claim-worker.ts";

const input: TaskClaimWorkerInput = {
	prompt: "Implement feature",
	history: ["initial user request", "assistant response"],
	cwd: "/repo/.worktrees/feature",
	projectRef: "merge-td",
	worktree: {
		isWorktree: true,
		root: "/repo/.worktrees/feature",
		branch: "feature",
	},
};

function result(stdout: string, code = 0): CommandResult {
	return { stdout, stderr: "", code };
}

describe("task claim worker", () => {
	it("runs isolated pi process with claim input and parses claimed result", async () => {
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

	it("returns none for malformed worker output", async () => {
		const exec = async (): Promise<CommandResult> => result("not json");
		await expect(createTaskClaimWorker(exec)(input)).resolves.toEqual({
			status: "none",
		});
	});
});
