import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	type PiTaskStoreData,
	piTasksToTodoistSubtasks,
	readPiTaskStore,
	sessionTaskPath,
	syncPiTasksToTodoist,
	syncTodoistToPiTasks,
	todoistSubtasksToPiTasks,
	writePiTaskStore,
} from "../src/pi-tasks-sync.ts";
import type { TodoistChild, TodoistClient } from "../src/todoist.ts";

const task = (overrides: Partial<TodoistChild> = {}): TodoistChild => ({
	id: "1",
	content: "[~] Build feature",
	description: "Details",
	projectId: "project",
	parentId: "parent",
	...overrides,
});

const piTask = (overrides: Partial<PiTaskStoreData["tasks"][number]> = {}) => ({
	id: "1",
	subject: "Build feature",
	description: "Details",
	status: "in_progress" as const,
	metadata: { source: "test" },
	blocks: ["2"],
	blockedBy: [],
	createdAt: 100,
	updatedAt: 200,
	...overrides,
});

describe("Pi task store", () => {
	it("uses the documented session path", () => {
		expect(sessionTaskPath("/repo", "session-1")).toBe(
			"/repo/.pi/tasks/tasks-session-1.json",
		);
	});

	it("normalizes optional store fields and rejects malformed envelopes", async () => {
		const directory = await mkdtemp(join(tmpdir(), "pi-todo-gate-tasks-"));
		const path = join(directory, "tasks.json");
		await writeFileStore(path, {
			nextId: 2,
			tasks: [{ id: "1", subject: "Task", description: "", status: "pending" }],
		});
		await expect(readPiTaskStore(path)).resolves.toMatchObject({
			nextId: 2,
			tasks: [{ id: "1", metadata: {}, blocks: [], blockedBy: [] }],
		});

		const malformed = join(directory, "malformed.json");
		await writeFileStore(malformed, { nextId: 1, wrong: [] });
		await expect(readPiTaskStore(malformed)).rejects.toThrow(
			"invalid Pi task store",
		);
	});

	it("refuses unsupported in-memory or custom task-store modes", async () => {
		const directory = await mkdtemp(join(tmpdir(), "pi-todo-gate-tasks-"));
		const path = join(directory, "tasks.json");
		const originalScope = process.env.PI_TASKS;
		const originalPath = process.env.PI_TASKS_PATH;
		process.env.PI_TASKS = "off";
		await expect(
			writePiTaskStore(path, { nextId: 1, tasks: [] }),
		).rejects.toThrow("unavailable");
		process.env.PI_TASKS = originalScope;
		process.env.PI_TASKS_PATH = "/custom/tasks.json";
		await expect(
			writePiTaskStore(path, { nextId: 1, tasks: [] }),
		).rejects.toThrow("incompatible");
		if (originalPath === undefined) delete process.env.PI_TASKS_PATH;
		else process.env.PI_TASKS_PATH = originalPath;
	});

	it("writes atomically and returns null for a missing store", async () => {
		const directory = await mkdtemp(join(tmpdir(), "pi-todo-gate-tasks-"));
		const path = join(directory, ".pi/tasks/tasks-session.json");
		const data: PiTaskStoreData = { nextId: 2, tasks: [piTask()] };
		await expect(readPiTaskStore(path)).resolves.toBeNull();
		await writePiTaskStore(path, data);
		await expect(readPiTaskStore(path)).resolves.toMatchObject(data);
		await expect(readFile(`${path}.tmp`, "utf8")).rejects.toThrow();
	});
});

describe("task conversion", () => {
	it("preserves statuses, descriptions, owner, dependencies, and stable IDs", () => {
		const children: TodoistChild[] = [
			task({
				id: "todoist-1",
				content: "[x] Build feature",
				description:
					"Details\n<!-- pi-todo-gate:id=17 -->\n<!-- pi-todo-gate:owner=worker -->\n<!-- pi-todo-gate:blocks=18 -->",
			}),
			task({
				id: "todoist-2",
				content: "[ ] Manual task",
				description: "manual",
			}),
		];
		const store = todoistSubtasksToPiTasks(children);
		expect(store.tasks[0]).toMatchObject({
			id: "17",
			subject: "Build feature",
			status: "completed",
			owner: "worker",
			blocks: ["18"],
		});
		expect(store.tasks[0].description).toBe("Details");
		expect(store.tasks[1]).toMatchObject({
			id: "18",
			subject: "Manual task",
			status: "pending",
		});
	});

	it("serializes status markers and private metadata without sync instructions", () => {
		const subtasks = piTasksToTodoistSubtasks([
			piTask({ status: "pending", subject: "Pending" }),
			piTask({
				id: "2",
				status: "completed",
				subject: "Done",
				owner: "worker",
				blockedBy: ["1"],
			}),
		]);
		expect(subtasks[0]).toEqual({
			content: "[ ] Pending",
			description: expect.stringContaining("pi-todo-gate:id=1"),
		});
		expect(subtasks[1]).toEqual({
			content: "[x] Done",
			description: expect.stringContaining("pi-todo-gate:blockedBy=1"),
		});
		expect(subtasks[1].description).not.toContain("synchron");
	});

	it("handles an empty parent", () => {
		expect(todoistSubtasksToPiTasks([])).toEqual({ nextId: 1, tasks: [] });
	});
});

describe("synchronization order", () => {
	it("deletes all descendants before creating direct subtasks", async () => {
		const calls: string[] = [];
		const children = [
			task({ id: "child", children: [task({ id: "grandchild" })] }),
		];
		const client = {
			listDescendants: async () => children,
			deleteDescendants: async () => {
				calls.push("delete");
			},
			createSubtask: async (
				_parent: string,
				input: { content: string; description: string },
			) => {
				calls.push(`create:${input.content}`);
				return task();
			},
		} as unknown as TodoistClient;
		await syncPiTasksToTodoist(client, "parent", {
			nextId: 2,
			tasks: [piTask()],
		});
		expect(calls).toEqual(["delete", "create:[~] Build feature"]);
	});

	it("stops and reports a failed delete or create", async () => {
		const client = {
			listDescendants: async () => [task()],
			deleteDescendants: async () => {
				throw new Error("delete failed");
			},
			createSubtask: async () => {
				throw new Error("must not create");
			},
		} as unknown as TodoistClient;
		await expect(
			syncPiTasksToTodoist(client, "parent", { nextId: 2, tasks: [piTask()] }),
		).rejects.toThrow("delete failed");
	});

	it("fetches inbound data before replacing the local store", async () => {
		const directory = await mkdtemp(join(tmpdir(), "pi-todo-gate-tasks-"));
		const path = join(directory, "tasks.json");
		const client = {
			listDescendants: async () => [
				task({ content: "[ ] From Todoist", description: "new" }),
			],
		} as unknown as TodoistClient;
		await expect(
			syncTodoistToPiTasks(client, "parent", path),
		).resolves.toMatchObject({ tasks: [{ subject: "From Todoist" }] });
		await expect(readPiTaskStore(path)).resolves.toMatchObject({
			tasks: [{ subject: "From Todoist" }],
		});
	});
});

async function writeFileStore(path: string, value: unknown): Promise<void> {
	const { writeFile, mkdir } = await import("node:fs/promises");
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, JSON.stringify(value), "utf8");
}
