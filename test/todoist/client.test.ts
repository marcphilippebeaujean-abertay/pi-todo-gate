import { describe, expect, it } from "vitest";
import type { CommandResult } from "../../src/shared/command.ts";
import {
	TodoistClient,
	TodoistError,
	type TodoistExec,
} from "../../src/todoist/client.ts";

const ok = (value: unknown): CommandResult => ({
	stdout: JSON.stringify(value),
	stderr: "",
	code: 0,
});
const okText = (stdout: string): CommandResult => ({
	stdout,
	stderr: "",
	code: 0,
});
const fail = (stderr: string): CommandResult => ({
	stdout: "",
	stderr,
	code: 1,
});

function fakeTodoist(responses: Record<string, CommandResult>): {
	exec: TodoistExec;
	calls: string[][];
} {
	const calls: string[][] = [];
	return {
		calls,
		exec: {
			run: async (args) => {
				calls.push([...args]);
				return (
					responses[args.join(" ")] ?? fail(`unexpected ${args.join(" ")}`)
				);
			},
		},
	};
}

const task = (overrides: Record<string, unknown> = {}) => ({
	id: "42",
	content: "Implement feature",
	description: "Details",
	projectId: "project-1",
	sectionName: "Todo",
	url: "https://todoist.com/showTask?id=42",
	...overrides,
});

describe("TodoistClient", () => {
	it("resolves projects by name and id", async () => {
		const byName = fakeTodoist({
			"project list --json": ok({ results: [{ id: "1", name: "Merge TD" }] }),
		});
		await expect(
			new TodoistClient(byName.exec).resolveProject("Merge TD"),
		).resolves.toEqual({ id: "1", name: "Merge TD" });

		const byId = fakeTodoist({
			"project list --json": ok({ results: [{ id: "1", name: "Merge TD" }] }),
		});
		await expect(
			new TodoistClient(byId.exec).resolveProject("id:1"),
		).resolves.toEqual({ id: "1", name: "Merge TD" });
	});

	it("rejects malformed list and task payloads", async () => {
		const malformedList = fakeTodoist({
			"project list --json": ok({ unexpected: [] }),
		});
		await expect(
			new TodoistClient(malformedList.exec).resolveProject("Merge TD"),
		).rejects.toThrow("expected a list payload");

		const malformedTask = fakeTodoist({
			"task view 42 --json": ok({ id: "42", description: "missing fields" }),
		});
		await expect(
			new TodoistClient(malformedTask.exec).getTask("42"),
		).rejects.toThrow("missing required fields");
	});

	it("rejects a task outside the configured project", async () => {
		const fake = fakeTodoist({
			"task view 42 --json": ok(task({ projectId: "other" })),
		});
		await expect(
			new TodoistClient(fake.exec).claimTask("42", { id: "project-1" }),
		).rejects.toThrow("configured project");
	});

	it("rejects another task already in progress", async () => {
		const fake = fakeTodoist({
			"task view 42 --json": ok(task({ sectionName: "In Progress" })),
		});
		await expect(
			new TodoistClient(fake.exec).claimTask("42", {
				id: "project-1",
				currentTaskId: "99",
			}),
		).rejects.toThrow("already in progress");
	});

	it("allows confirmed switching to another task already in progress", async () => {
		const fake = fakeTodoist({
			"task view 42 --json": ok(task({ sectionName: "In Progress" })),
		});
		await expect(
			new TodoistClient(fake.exec).claimTask("42", {
				id: "project-1",
				allowInProgress: true,
			}),
		).resolves.toMatchObject({ id: "42" });
	});

	it("resolves section names through supported td section list", async () => {
		const fake = fakeTodoist({
			"task view 42 --json": ok(
				task({ sectionName: undefined, sectionId: "section-1" }),
			),
			"section list --project id:project-1 --json": ok({
				results: [{ id: "section-1", name: "In progress" }],
			}),
		});
		await expect(
			new TodoistClient(fake.exec).claimTask("42", {
				id: "project-1",
				currentTaskId: "99",
			}),
		).rejects.toThrow("already in progress");
	});

	it("prefers webUrl when returning a canonical claimed-task URL", async () => {
		const fake = fakeTodoist({
			"task view 42 --json": ok(
				task({
					webUrl: "https://app.todoist.com/app/task/42",
					url: "https://todoist.com/showTask?id=42",
				}),
			),
			"task move 42 --section In Progress --project id:project-1": okText(
				"Task moved successfully",
			),
		});
		await expect(
			new TodoistClient(fake.exec).claimTask("42", { id: "project-1" }),
		).resolves.toMatchObject({
			url: "https://app.todoist.com/app/task/42",
		});
	});

	it("accepts the already claimed task and moves a valid task", async () => {
		const fake = fakeTodoist({
			"task view 42 --json": ok(task({ sectionName: "Todo" })),
			"task move 42 --section In Progress --project id:project-1": ok({}),
		});
		await expect(
			new TodoistClient(fake.exec).claimTask("42", {
				id: "project-1",
				currentTaskId: "42",
			}),
		).resolves.toMatchObject({ id: "42" });
		expect(fake.calls).toEqual([
			["task", "view", "42", "--json"],
			[
				"task",
				"move",
				"42",
				"--section",
				"In Progress",
				"--project",
				"id:project-1",
			],
		]);
	});

	it("accepts an id-prefixed ref for a task already in progress", async () => {
		const fake = fakeTodoist({
			"task view id:42 --json": ok(task({ sectionName: "In progress" })),
		});

		await expect(
			new TodoistClient(fake.exec).claimTask("id:42", {
				id: "project-1",
				currentTaskId: "id:42",
			}),
		).resolves.toMatchObject({ id: "42", sectionName: "In progress" });
		expect(fake.calls).toEqual([["task", "view", "id:42", "--json"]]);
	});

	it("rejects unsafe URL schemes from CLI data", async () => {
		const fake = fakeTodoist({
			"task view 42 --json": ok(
				task({ url: "javascript:alert(1)", webUrl: "\u001b]8;;evil" }),
			),
		});
		const result = await new TodoistClient(fake.exec).getTask("42");
		expect(result.url).toBe("https://app.todoist.com/app/task/42");
		expect(result.webUrl).toBeUndefined();
	});

	it("uses webUrl before url and constructs a fallback URL", async () => {
		const web = fakeTodoist({
			"task view 42 --json": ok(
				task({ webUrl: "https://app.todoist.com/app/task/42" }),
			),
		});
		await expect(
			new TodoistClient(web.exec).getTask("42"),
		).resolves.toMatchObject({ webUrl: "https://app.todoist.com/app/task/42" });

		const fallback = fakeTodoist({
			"task view 42 --json": ok(task({ url: undefined, webUrl: undefined })),
		});
		await expect(
			new TodoistClient(fallback.exec).getTask("42"),
		).resolves.toMatchObject({ url: "https://app.todoist.com/app/task/42" });
	});

	it("returns a typed sanitized error for failed CLI commands", async () => {
		const fake = fakeTodoist({
			"task view 42 --json": fail("token=super-secret failed"),
		});
		const error = await new TodoistClient(fake.exec)
			.getTask("42")
			.catch((value: unknown) => value);
		expect(error).toBeInstanceOf(TodoistError);
		expect((error as Error).message).not.toContain("super-secret");
		expect((error as Error).message).toContain("task view");
	});
});
