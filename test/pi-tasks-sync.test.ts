const VALUE_1 = "1";
const BUILD_FEATURE = "[~] Build feature";
const DETAILS = "Details";
const PROJECT = "project";
const PARENT = "parent";
const BUILD_FEATURE_2 = "Build feature";
const TEST = "test";
const VALUE_2 = "2";
const USES_THE_DOCUMENTED_SESSION_PATH = "uses the documented session path";
const REPO = "/repo";
const SESSION_1 = "session-1";
const REPO_PI_TASKS_TASKS_SESSION_1_JSON =
	"/repo/.pi/tasks/tasks-session-1.json";
const NORMALIZES_OPTIONAL_STORE_FIELDS_AND_REJECTS_MALFORMED =
	"normalizes optional store fields and rejects malformed envelopes";
const PI_TODO_GATE_TASKS = "pi-todo-gate-tasks-";
const TASKS_JSON = "tasks.json";
const TASK = "Task";
const EMPTY_STRING = "";
const PENDING_VALUE = "pending";
const MALFORMED_JSON = "malformed.json";
const INVALID_PI_TASK_STORE = "invalid Pi task store";
const REFUSES_UNSUPPORTED_IN_MEMORY_OR_CUSTOM_TASK =
	"refuses unsupported in-memory or custom task-store modes";
const OFF_VALUE = "off";
const UNAVAILABLE = "unavailable";
const CUSTOM_TASKS_JSON = "/custom/tasks.json";
const INCOMPATIBLE = "incompatible";
const WRITES_ATOMICALLY_AND_RETURNS_NULL_FOR_A =
	"writes atomically and returns null for a missing store";
const PROPAGATES_NON_MISSING_STORE_ERRORS =
	"propagates non-missing task-store errors";
const INVALID_TASK_STORE_PATH = "/dev/null/tasks.json";
const PI_TASKS_TASKS_SESSION_JSON = ".pi/tasks/tasks-session.json";
const UTF8_ENCODING = "utf8";
const PRESERVES_STATUSES_DESCRIPTIONS_OWNER_DEPENDENCIES_AND_STABLE =
	"preserves statuses, descriptions, owner, dependencies, and stable IDs";
const TODOIST_1 = "todoist-1";
const X_BUILD_FEATURE = "[x] Build feature";
const DETAILS_PI_TODO_GATE_ID_17_PI =
	"Details\n<!-- pi-todo-gate:id=17 -->\n<!-- pi-todo-gate:owner=worker -->\n<!-- pi-todo-gate:blocks=18 -->";
const TODOIST_2 = "todoist-2";
const MANUAL_TASK = "[ ] Manual task";
const MANUAL = "manual";
const VALUE_17 = "17";
const COMPLETED_VALUE = "completed";
const WORKER = "worker";
const VALUE_18 = "18";
const MANUAL_TASK_2 = "Manual task";
const SERIALIZES_STATUS_MARKERS_AND_PRIVATE_METADATA_WITHOUT =
	"serializes status markers and private metadata without sync instructions";
const PENDING_VALUE_2 = "Pending";
const DONE = "Done";
const PENDING_VALUE_3 = "[ ] Pending";
const PI_TODO_GATE_ID_1 = "pi-todo-gate:id=1";
const X_DONE = "[x] Done";
const PI_TODO_GATE_BLOCKEDBY_1 = "pi-todo-gate:blockedBy=1";
const SYNCHRON = "synchron";
const HANDLES_AN_EMPTY_PARENT = "handles an empty parent";
const DELETES_ALL_DESCENDANTS_BEFORE_CREATING_DIRECT_SUBTASKS =
	"deletes all descendants before creating direct subtasks";
const CHILD = "child";
const GRANDCHILD = "grandchild";
const VALUE_DELETE = "delete";
const CREATE_BUILD_FEATURE = "create:[~] Build feature";
const STOPS_AND_REPORTS_A_FAILED_DELETE_OR =
	"stops and reports a failed delete or create";
const DELETE_FAILED = "delete failed";
const MUST_NOT_CREATE = "must not create";
const STOPS_CREATING_SUBTASKS_WHEN_THE_ASSOCIATION_IS =
	"stops creating subtasks when the association is invalidated";
const SYNCHRONIZATION_CANCELLED = "synchronization cancelled";
const FETCHES_INBOUND_DATA_BEFORE_REPLACING_THE_LOCAL =
	"fetches inbound data before replacing the local store";
const FROM_TODOIST = "[ ] From Todoist";
const VALUE_NEW = "new";
const FROM_TODOIST_2 = "From Todoist";
const NODE_FS_PROMISES = "node:fs/promises";

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
	id: VALUE_1,
	content: BUILD_FEATURE,
	description: DETAILS,
	projectId: PROJECT,
	parentId: PARENT,
	...overrides,
});

const piTask = (overrides: Partial<PiTaskStoreData["tasks"][number]> = {}) => ({
	id: VALUE_1,
	subject: BUILD_FEATURE_2,
	description: DETAILS,
	status: "in_progress" as const,
	metadata: { source: TEST },
	blocks: [VALUE_2],
	blockedBy: [],
	createdAt: 100,
	updatedAt: 200,
	...overrides,
});

describe("Pi task store", () => {
	it(USES_THE_DOCUMENTED_SESSION_PATH, () => {
		expect(sessionTaskPath(REPO, SESSION_1)).toBe(
			REPO_PI_TASKS_TASKS_SESSION_1_JSON,
		);
	});

	it(NORMALIZES_OPTIONAL_STORE_FIELDS_AND_REJECTS_MALFORMED, async () => {
		const directory = await mkdtemp(join(tmpdir(), PI_TODO_GATE_TASKS));
		const path = join(directory, TASKS_JSON);
		await writeFileStore(path, {
			nextId: 2,
			tasks: [
				{
					id: VALUE_1,
					subject: TASK,
					description: EMPTY_STRING,
					status: PENDING_VALUE,
				},
			],
		});
		await expect(readPiTaskStore(path)).resolves.toMatchObject({
			nextId: 2,
			tasks: [{ id: VALUE_1, metadata: {}, blocks: [], blockedBy: [] }],
		});

		const malformed = join(directory, MALFORMED_JSON);
		await writeFileStore(malformed, { nextId: 1, wrong: [] });
		await expect(readPiTaskStore(malformed)).rejects.toThrow(
			INVALID_PI_TASK_STORE,
		);
	});

	it(REFUSES_UNSUPPORTED_IN_MEMORY_OR_CUSTOM_TASK, async () => {
		const directory = await mkdtemp(join(tmpdir(), PI_TODO_GATE_TASKS));
		const path = join(directory, TASKS_JSON);
		const originalScope = process.env.PI_TASKS;
		const originalPath = process.env.PI_TASKS_PATH;
		process.env.PI_TASKS = OFF_VALUE;
		await expect(
			writePiTaskStore(path, { nextId: 1, tasks: [] }),
		).rejects.toThrow(UNAVAILABLE);
		process.env.PI_TASKS = originalScope;
		process.env.PI_TASKS_PATH = CUSTOM_TASKS_JSON;
		await expect(
			writePiTaskStore(path, { nextId: 1, tasks: [] }),
		).rejects.toThrow(INCOMPATIBLE);
		if (originalPath === undefined) delete process.env.PI_TASKS_PATH;
		else process.env.PI_TASKS_PATH = originalPath;
	});

	it(PROPAGATES_NON_MISSING_STORE_ERRORS, async () => {
		await expect(readPiTaskStore(INVALID_TASK_STORE_PATH)).rejects.toThrow();
	});

	it(WRITES_ATOMICALLY_AND_RETURNS_NULL_FOR_A, async () => {
		const directory = await mkdtemp(join(tmpdir(), PI_TODO_GATE_TASKS));
		const path = join(directory, PI_TASKS_TASKS_SESSION_JSON);
		const data: PiTaskStoreData = { nextId: 2, tasks: [piTask()] };
		await expect(readPiTaskStore(path)).resolves.toBeNull();
		await writePiTaskStore(path, data);
		await expect(readPiTaskStore(path)).resolves.toMatchObject(data);
		await expect(readFile(`${path}.tmp`, UTF8_ENCODING)).rejects.toThrow();
	});
});

describe("task conversion", () => {
	it(PRESERVES_STATUSES_DESCRIPTIONS_OWNER_DEPENDENCIES_AND_STABLE, () => {
		const children: TodoistChild[] = [
			task({
				id: TODOIST_1,
				content: X_BUILD_FEATURE,
				description: DETAILS_PI_TODO_GATE_ID_17_PI,
			}),
			task({
				id: TODOIST_2,
				content: MANUAL_TASK,
				description: MANUAL,
			}),
		];
		const store = todoistSubtasksToPiTasks(children);
		expect(store.tasks[0]).toMatchObject({
			id: VALUE_17,
			subject: BUILD_FEATURE_2,
			status: COMPLETED_VALUE,
			owner: WORKER,
			blocks: [VALUE_18],
		});
		expect(store.tasks[0].description).toBe(DETAILS);
		expect(store.tasks[1]).toMatchObject({
			id: VALUE_18,
			subject: MANUAL_TASK_2,
			status: PENDING_VALUE,
		});
	});

	it(SERIALIZES_STATUS_MARKERS_AND_PRIVATE_METADATA_WITHOUT, () => {
		const subtasks = piTasksToTodoistSubtasks([
			piTask({ status: PENDING_VALUE, subject: PENDING_VALUE_2 }),
			piTask({
				id: VALUE_2,
				status: COMPLETED_VALUE,
				subject: DONE,
				owner: WORKER,
				blockedBy: [VALUE_1],
			}),
		]);
		expect(subtasks[0]).toEqual({
			content: PENDING_VALUE_3,
			description: expect.stringContaining(PI_TODO_GATE_ID_1),
		});
		expect(subtasks[1]).toEqual({
			content: X_DONE,
			description: expect.stringContaining(PI_TODO_GATE_BLOCKEDBY_1),
		});
		expect(subtasks[1].description).not.toContain(SYNCHRON);
	});

	it(HANDLES_AN_EMPTY_PARENT, () => {
		expect(todoistSubtasksToPiTasks([])).toEqual({ nextId: 1, tasks: [] });
	});
});

describe("synchronization order", () => {
	it(DELETES_ALL_DESCENDANTS_BEFORE_CREATING_DIRECT_SUBTASKS, async () => {
		const calls: string[] = [];
		const children = [
			task({
				id: CHILD,
				children: [task({ id: GRANDCHILD })],
			}),
		];
		const client = {
			listDescendants: async () => children,
			deleteDescendants: async () => {
				calls.push(VALUE_DELETE);
			},
			createSubtask: async (
				_parent: string,
				input: { content: string; description: string },
			) => {
				calls.push(`create:${input.content}`);
				return task();
			},
		} as unknown as TodoistClient;
		await syncPiTasksToTodoist(client, PARENT, {
			nextId: 2,
			tasks: [piTask()],
		});
		expect(calls).toEqual([VALUE_DELETE, CREATE_BUILD_FEATURE]);
	});

	it(STOPS_AND_REPORTS_A_FAILED_DELETE_OR, async () => {
		const client = {
			listDescendants: async () => [task()],
			deleteDescendants: async () => {
				throw new Error(DELETE_FAILED);
			},
			createSubtask: async () => {
				throw new Error(MUST_NOT_CREATE);
			},
		} as unknown as TodoistClient;
		await expect(
			syncPiTasksToTodoist(client, PARENT, {
				nextId: 2,
				tasks: [piTask()],
			}),
		).rejects.toThrow(DELETE_FAILED);
	});

	it(STOPS_CREATING_SUBTASKS_WHEN_THE_ASSOCIATION_IS, async () => {
		let releaseDelete!: () => void;
		const deleteFinished = new Promise<void>((resolve) => {
			releaseDelete = resolve;
		});
		let deleteStarted!: () => void;
		const started = new Promise<void>((resolve) => {
			deleteStarted = resolve;
		});
		let current = true;
		let creates = 0;
		const client = {
			listDescendants: async () => [task()],
			deleteDescendants: async () => {
				deleteStarted();
				await deleteFinished;
			},
			createSubtask: async () => {
				creates += 1;
				return task();
			},
		} as unknown as TodoistClient;
		const sync = syncPiTasksToTodoist(
			client,
			PARENT,
			{ nextId: 2, tasks: [piTask()] },
			() => current,
		);
		await started;
		current = false;
		releaseDelete();
		await expect(sync).rejects.toThrow(SYNCHRONIZATION_CANCELLED);
		expect(creates).toBe(0);
	});

	it(FETCHES_INBOUND_DATA_BEFORE_REPLACING_THE_LOCAL, async () => {
		const directory = await mkdtemp(join(tmpdir(), PI_TODO_GATE_TASKS));
		const path = join(directory, TASKS_JSON);
		const client = {
			listDescendants: async () => [
				task({
					content: FROM_TODOIST,
					description: VALUE_NEW,
				}),
			],
		} as unknown as TodoistClient;
		await expect(
			syncTodoistToPiTasks(client, PARENT, path),
		).resolves.toMatchObject({ tasks: [{ subject: FROM_TODOIST_2 }] });
		await expect(readPiTaskStore(path)).resolves.toMatchObject({
			tasks: [{ subject: FROM_TODOIST_2 }],
		});
	});
});

async function writeFileStore(path: string, value: unknown): Promise<void> {
	const { writeFile, mkdir } = await import(NODE_FS_PROMISES);
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, JSON.stringify(value), UTF8_ENCODING);
}
