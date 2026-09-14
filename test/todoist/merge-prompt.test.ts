import { describe, expect, it } from "vitest";
import type { CommandResult } from "../../src/shared/command.ts";
import { TodoistClient } from "../../src/todoist/client.ts";

const ok = (value: unknown): CommandResult => ({
	stdout: JSON.stringify(value),
	stderr: "",
	code: 0,
});

describe("TodoistClient completion", () => {
	it("completes a task with its reference", async () => {
		const calls: string[][] = [];
		const client = new TodoistClient({
			run: async (args) => {
				calls.push([...args]);
				return ok({});
			},
		});

		await client.completeTask("task-1");

		expect(calls).toEqual([["task", "complete", "task-1"]]);
	});
});
