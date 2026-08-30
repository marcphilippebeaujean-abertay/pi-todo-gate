import {
	access,
	mkdir,
	readFile,
	rename,
	unlink,
	writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { TodoistChild, TodoistClient } from "./todoist.ts";

export interface PiTask {
	id: string;
	subject: string;
	description: string;
	status: "pending" | "in_progress" | "completed";
	activeForm?: string;
	owner?: string;
	metadata: Record<string, unknown>;
	blocks: string[];
	blockedBy: string[];
	createdAt: number;
	updatedAt: number;
}

export interface PiTaskStoreData {
	nextId: number;
	tasks: PiTask[];
}

const PRIVATE_PREFIX = "<!-- pi-todo-gate:";
const PRIVATE_LINE = /^<!-- pi-todo-gate:([a-zA-Z]+)=(.*?) -->$/;

export function sessionTaskPath(cwd: string, sessionId: string): string {
	return join(resolve(cwd), ".pi", "tasks", `tasks-${sessionId}.json`);
}

function ensureFileBacked(path: string): void {
	const scope = (process.env.PI_TASKS ?? "").toLowerCase();
	if (scope === "off" || scope === "memory") {
		throw new Error(
			"Pi task store is unavailable in the configured memory/off scope",
		);
	}
	if (process.env.PI_TASK_LIST_ID || process.env.PI_TASKS_PATH) {
		throw new Error("Pi task store uses an incompatible configured path");
	}
	if (!path) throw new Error("Pi task store path is required");
}

function normalizeTask(value: unknown): PiTask {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new Error("invalid Pi task store task");
	const data = value as Partial<PiTask>;
	if (
		typeof data.id !== "string" ||
		typeof data.subject !== "string" ||
		typeof data.description !== "string"
	) {
		throw new Error("invalid Pi task store task");
	}
	const status =
		data.status === "pending" ||
		data.status === "in_progress" ||
		data.status === "completed"
			? data.status
			: "pending";
	const now = Date.now();
	return {
		id: data.id,
		subject: data.subject,
		description: data.description,
		status,
		activeForm:
			typeof data.activeForm === "string" ? data.activeForm : undefined,
		owner: typeof data.owner === "string" ? data.owner : undefined,
		metadata:
			data.metadata &&
			typeof data.metadata === "object" &&
			!Array.isArray(data.metadata)
				? data.metadata
				: {},
		blocks: Array.isArray(data.blocks)
			? data.blocks.filter((id): id is string => typeof id === "string")
			: [],
		blockedBy: Array.isArray(data.blockedBy)
			? data.blockedBy.filter((id): id is string => typeof id === "string")
			: [],
		createdAt: typeof data.createdAt === "number" ? data.createdAt : now,
		updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : now,
	};
}

export async function readPiTaskStore(
	path: string,
): Promise<PiTaskStoreData | null> {
	ensureFileBacked(path);
	try {
		await access(path);
	} catch {
		return null;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(await readFile(path, "utf8"));
	} catch {
		throw new Error("invalid Pi task store JSON");
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
		throw new Error("invalid Pi task store");
	const data = parsed as Partial<PiTaskStoreData>;
	if (!Array.isArray(data.tasks)) throw new Error("invalid Pi task store");
	const tasks = data.tasks.map(normalizeTask);
	const maxId = tasks.reduce((max, task) => {
		const value = Number(task.id);
		return Number.isInteger(value) && value > max ? value : max;
	}, 0);
	const nextId =
		typeof data.nextId === "number" &&
		Number.isInteger(data.nextId) &&
		data.nextId > maxId
			? data.nextId
			: maxId + 1;
	return { nextId, tasks };
}

const taskStoreWrites = new Map<string, Promise<void>>();

async function writePiTaskStoreNow(
	path: string,
	data: PiTaskStoreData,
): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const temporary = `${path}.tmp`;
	await writeFile(temporary, JSON.stringify(data, null, 2), "utf8");
	try {
		await rename(temporary, path);
	} catch (error) {
		try {
			await unlink(temporary);
		} catch {
			/* preserve the original rename error */
		}
		throw error;
	}
}

export async function writePiTaskStore(
	path: string,
	data: PiTaskStoreData,
): Promise<void> {
	ensureFileBacked(path);
	const previous = taskStoreWrites.get(path) ?? Promise.resolve();
	const operation = previous
		.catch(() => {})
		.then(() => writePiTaskStoreNow(path, data));
	taskStoreWrites.set(path, operation);
	try {
		await operation;
	} finally {
		if (taskStoreWrites.get(path) === operation) taskStoreWrites.delete(path);
	}
}

function metadataLines(task: PiTask): string[] {
	const lines = [`${PRIVATE_PREFIX}id=${task.id} -->`];
	if (task.owner) lines.push(`${PRIVATE_PREFIX}owner=${task.owner} -->`);
	if (task.blocks.length)
		lines.push(`${PRIVATE_PREFIX}blocks=${task.blocks.join(",")} -->`);
	if (task.blockedBy.length)
		lines.push(`${PRIVATE_PREFIX}blockedBy=${task.blockedBy.join(",")} -->`);
	return lines;
}

function withoutPrivateLines(description: string): string {
	return description
		.split(/\r?\n/)
		.filter((line) => !line.trim().startsWith(PRIVATE_PREFIX))
		.join("\n")
		.trim();
}

function descriptionWithMetadata(task: PiTask): string {
	const original = withoutPrivateLines(task.description);
	const metadata = metadataLines(task);
	return original ? `${original}\n${metadata.join("\n")}` : metadata.join("\n");
}

function parseStatus(content: string): {
	status: PiTask["status"];
	subject: string;
} {
	const marker = content.match(/^\[([ x~])\]\s*(.*)$/i);
	if (!marker) return { status: "pending", subject: content };
	const status =
		marker[1].toLowerCase() === "x"
			? "completed"
			: marker[1] === "~"
				? "in_progress"
				: "pending";
	return { status, subject: marker[2] };
}

function markerData(description: string): {
	clean: string;
	values: Record<string, string>;
} {
	const values: Record<string, string> = {};
	const cleanLines: string[] = [];
	for (const line of description.split(/\r?\n/)) {
		const match = line.trim().match(PRIVATE_LINE);
		if (match) values[match[1]] = match[2];
		else cleanLines.push(line);
	}
	return { clean: cleanLines.join("\n").trim(), values };
}

function flattened(children: readonly TodoistChild[]): TodoistChild[] {
	const result: TodoistChild[] = [];
	for (const child of children) {
		result.push(child);
		if (child.children?.length) result.push(...flattened(child.children));
	}
	return result;
}

export function todoistSubtasksToPiTasks(
	children: readonly TodoistChild[],
): PiTaskStoreData {
	const tasks: PiTask[] = [];
	const used = new Set<string>();
	let nextId = 1;
	for (const child of flattened(children)) {
		const parsed = parseStatus(child.content);
		const metadata = markerData(child.description);
		let id = metadata.values.id;
		if (!id || used.has(id)) {
			while (used.has(String(nextId))) nextId += 1;
			id = String(nextId);
		}
		used.add(id);
		const numericId = Number(id);
		if (Number.isInteger(numericId) && numericId >= nextId)
			nextId = numericId + 1;
		const blocks = metadata.values.blocks
			? metadata.values.blocks.split(",").filter(Boolean)
			: [];
		const blockedBy = metadata.values.blockedBy
			? metadata.values.blockedBy.split(",").filter(Boolean)
			: [];
		tasks.push({
			id,
			subject: parsed.subject,
			description: metadata.clean,
			status: parsed.status,
			owner: metadata.values.owner || undefined,
			metadata: {},
			blocks,
			blockedBy,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
	}
	return { nextId, tasks };
}

export function piTasksToTodoistSubtasks(
	tasks: readonly PiTask[],
): Array<{ content: string; description: string }> {
	return tasks.map((task) => ({
		content: `${task.status === "completed" ? "[x]" : task.status === "in_progress" ? "[~]" : "[ ]"} ${task.subject}`,
		description: descriptionWithMetadata(task),
	}));
}

class SyncCancelledError extends Error {
	constructor() {
		super("synchronization cancelled");
	}
}

export async function syncPiTasksToTodoist(
	client: TodoistClient,
	parentRef: string,
	store: PiTaskStoreData,
	isCurrent?: () => boolean,
): Promise<void> {
	const assertCurrent = (): void => {
		if (isCurrent && !isCurrent()) throw new SyncCancelledError();
	};
	assertCurrent();
	const descendants = await client.listDescendants(parentRef);
	assertCurrent();
	await client.deleteDescendants(descendants, isCurrent);
	assertCurrent();
	for (const subtask of piTasksToTodoistSubtasks(store.tasks)) {
		assertCurrent();
		await client.createSubtask(parentRef, subtask);
	}
}

export async function syncTodoistToPiTasks(
	client: TodoistClient,
	parentRef: string,
	path: string,
	isCurrent?: () => boolean,
): Promise<PiTaskStoreData> {
	const descendants = await client.listDescendants(parentRef);
	if (isCurrent && !isCurrent()) throw new SyncCancelledError();
	const store = todoistSubtasksToPiTasks(descendants);
	await writePiTaskStore(path, store);
	return store;
}
