import { describe, expect, it, vi } from "vitest";
import type { CommandResult } from "../../src/shared/command.ts";
import { parseResult } from "../../src/todoist/claim-result.ts";
import {
	createTaskClaimWorker,
	type TaskClaimWorkerInput,
} from "../../src/todoist/claim-worker.ts";

const input: TaskClaimWorkerInput = {
	sessionId: "session-current",
	prompt: "Implement feature",
	cwd: "/repo/.worktrees/feature",
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

describe("Todoist task claim worker", () => {
	it("runs a claim worker with PR context and parses claim evidence", async () => {
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
				expect(prompt).toContain("inspection");
				expect(prompt).toContain("In Progress");
				expect(prompt).toContain("useful description");
				expect(prompt).toContain("create");
				expect(prompt).toContain("move");
				expect(prompt).toContain(input.prompt);
				expect(prompt).toContain(input.projectRef);
				expect(prompt).toContain(input.prRef);
				expect(prompt).toContain(input.sessionId);
				expect(prompt).toContain(input.worktree.branch ?? "");
				return result(
					message(
						'{"sessionId":"session-current","action":"claim","taskData":{"title":"Existing","description":"Details","id":"42"},"error":null}',
					),
				);
			},
		);

		await expect(createTaskClaimWorker(exec)(input)).resolves.toEqual({
			sessionId: input.sessionId,
			action: "claim",
			taskData: { title: "Existing", description: "Details", id: "42" },
			error: null,
		});
	});

	it("parses completed creation as claim evidence", async () => {
		const exec = async (): Promise<CommandResult> =>
			result(
				message(
					'{"sessionId":"session-current","action":"claim","taskData":{"title":"New","description":"Proposed","id":"43"},"error":null}',
				),
			);
		await expect(createTaskClaimWorker(exec)(input)).resolves.toEqual({
			sessionId: input.sessionId,
			action: "claim",
			taskData: { title: "New", description: "Proposed", id: "43" },
			error: null,
		});
	});

	it("parses error proposals", async () => {
		const exec = async (): Promise<CommandResult> =>
			result(
				message(
					'{"sessionId":"session-current","action":"error","taskData":null,"error":"Unavailable"}',
				),
			);
		await expect(createTaskClaimWorker(exec)(input)).resolves.toEqual({
			action: "error",
			taskData: null,
			error: "Unavailable",
			sessionId: input.sessionId,
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
			sessionId: "",
			action: "error",
			taskData: null,
			error: "Invalid claim worker result.",
		});
		expect(
			parseResult(message('{"status":"collision","taskRef":"42"}')),
		).toEqual({
			sessionId: "",
			action: "error",
			taskData: null,
			error: "Invalid claim worker result.",
		});
	});

	it("returns an error proposal for malformed worker output", async () => {
		const exec = async (): Promise<CommandResult> => result("not json");
		await expect(createTaskClaimWorker(exec)(input)).resolves.toEqual({
			sessionId: input.sessionId,
			action: "error",
			taskData: null,
			error: "Invalid claim worker result.",
		});
	});
});
