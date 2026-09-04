import { describe, expect, it, vi } from "vitest";
import type { CommandResult } from "../../src/shared/command.ts";
import { parseResult } from "../../src/todoist/claim-result.ts";
import {
	createTaskClaimWorker,
	type TaskClaimWorkerInput,
} from "../../src/todoist/claim-worker.ts";

const input: TaskClaimWorkerInput = {
	prompt: "Implement feature",
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

const message = (text: string): string =>
	JSON.stringify({
		type: "message_end",
		message: { role: "assistant", content: [{ type: "text", text }] },
	});

describe("Todoist task claim worker", () => {
	it("runs an inspection-only worker and parses claim proposal", async () => {
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
						"low",
					]),
				);
				const prompt = args.at(-1) ?? "";
				expect(prompt).toContain("inspection");
				expect(prompt).toContain("In Progress");
				expect(prompt).toContain("Always propose a description");
				expect(prompt).toContain("Do not modify");
				expect(prompt).toContain(input.prompt);
				expect(prompt).toContain(input.projectRef);
				expect(prompt).toContain(input.worktree.branch ?? "");
				return result(
					message(
						'{"action":"claim","taskData":{"title":"Existing","description":"Details","id":"42"},"error":null}',
					),
				);
			},
		);

		await expect(createTaskClaimWorker(exec)(input)).resolves.toEqual({
			action: "claim",
			taskData: { title: "Existing", description: "Details", id: "42" },
			error: null,
		});
	});

	it("parses create proposals", async () => {
		const exec = async (): Promise<CommandResult> =>
			result(
				message(
					'{"action":"create","taskData":{"title":"New","description":"Proposed","id":null},"error":null}',
				),
			);
		await expect(createTaskClaimWorker(exec)(input)).resolves.toEqual({
			action: "create",
			taskData: { title: "New", description: "Proposed", id: null },
			error: null,
		});
	});

	it("parses error proposals", async () => {
		const exec = async (): Promise<CommandResult> =>
			result(
				message('{"action":"error","taskData":null,"error":"Unavailable"}'),
			);
		await expect(createTaskClaimWorker(exec)(input)).resolves.toEqual({
			action: "error",
			taskData: null,
			error: "Unavailable",
		});
	});

	it("redacts bearer credentials from worker failure details", async () => {
		const exec = async (): Promise<CommandResult> =>
			result("", 1, "provider unavailable Authorization: Bearer secret");
		await expect(createTaskClaimWorker(exec)(input)).rejects.toThrow(
			"claim worker exited with code 1: provider unavailable Authorization: Bearer [redacted]",
		);
	});

	it("rejects legacy and inconsistent proposal output", () => {
		expect(
			parseResult(
				message(
					'{"action":"claim","taskData":{"title":"Bad","description":"Bad","id":null},"error":null}',
				),
			),
		).toEqual({
			action: "error",
			taskData: null,
			error: "Invalid claim worker result.",
		});
		expect(
			parseResult(message('{"status":"collision","taskRef":"42"}')),
		).toEqual({
			action: "error",
			taskData: null,
			error: "Invalid claim worker result.",
		});
	});

	it("returns an error proposal for malformed worker output", async () => {
		const exec = async (): Promise<CommandResult> => result("not json");
		await expect(createTaskClaimWorker(exec)(input)).resolves.toEqual({
			action: "error",
			taskData: null,
			error: "Invalid claim worker result.",
		});
	});
});
