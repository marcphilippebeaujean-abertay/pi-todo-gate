const PI = ".pi";
const TASKS = "tasks";
const EMPTY_STRING = "";
const OFF_VALUE = "off";
const MEMORY = "memory";
const PI_TASK_STORE_IS_UNAVAILABLE_IN_THE =
	"Pi task store is unavailable in the configured memory/off scope";
const PI_TASK_STORE_USES_AN_INCOMPATIBLE_CONFIGURED =
	"Pi task store uses an incompatible configured path";
const PI_TASK_STORE_PATH_IS_REQUIRED = "Pi task store path is required";
const INVALID_PI_TASK_STORE_TASK = "invalid Pi task store task";
const PENDING_VALUE = "pending";
const IN_PROGRESS_VALUE = "in_progress";
const COMPLETED_VALUE = "completed";
const UTF8_ENCODING = "utf8";
const INVALID_PI_TASK_STORE_JSON = "invalid Pi task store JSON";
const INVALID_PI_TASK_STORE = "invalid Pi task store";
const TEXT = ",";
const TEXT_2 = "\n";
const X = "x";
const TEXT_3 = "~";
const X_2 = "[x]";
const TEXT_4 = "[~]";
const TEXT_5 = "[ ]";
const SYNCHRONIZATION_CANCELLED = "synchronization cancelled";

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
	return join(resolve(cwd), PI, TASKS, `tasks-${sessionId}.json`);
}

function ensureFileBacked(path: string): void {
	const scope = (process.env.PI_TASKS ?? EMPTY_STRING).toLowerCase();
	if (scope === OFF_VALUE || scope === MEMORY) {
		throw new Error(PI_TASK_STORE_IS_UNAVAILABLE_IN_THE);
	}
	if (process.env.PI_TASK_LIST_ID || process.env.PI_TASKS_PATH) {
		throw new Error(PI_TASK_STORE_USES_AN_INCOMPATIBLE_CONFIGURED);
	}
	const isMissingTaskStorePath: boolean = !path;
	if (isMissingTaskStorePath) throw new Error(PI_TASK_STORE_PATH_IS_REQUIRED);
}

function metadataRecord(value: unknown): Record<string, unknown> {
	if (typeof value !== "object" || value === null) return {};
	if (Array.isArray(value)) return {};
	return value as Record<string, unknown>;
}

function normalizeTask(value: unknown): PiTask {
	if (typeof value !== "object" || value === null)
		throw new Error(INVALID_PI_TASK_STORE_TASK);
	if (Array.isArray(value)) throw new Error(INVALID_PI_TASK_STORE_TASK);
	const data = value as Partial<PiTask>;
	if (typeof data.id !== "string") throw new Error(INVALID_PI_TASK_STORE_TASK);
	if (typeof data.subject !== "string")
		throw new Error(INVALID_PI_TASK_STORE_TASK);
	if (typeof data.description !== "string")
		throw new Error(INVALID_PI_TASK_STORE_TASK);
	let status: PiTask["status"] = PENDING_VALUE;
	if (data.status === IN_PROGRESS_VALUE) status = IN_PROGRESS_VALUE;
	if (data.status === COMPLETED_VALUE) status = COMPLETED_VALUE;
	const now = Date.now();
	return {
		id: data.id,
		subject: data.subject,
		description: data.description,
		status,
		activeForm:
			typeof data.activeForm === "string" ? data.activeForm : undefined,
		owner: typeof data.owner === "string" ? data.owner : undefined,
		metadata: metadataRecord(data.metadata),
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
		parsed = JSON.parse(await readFile(path, UTF8_ENCODING));
	} catch {
		throw new Error(INVALID_PI_TASK_STORE_JSON);
	}
	if (typeof parsed !== "object" || parsed === null)
		throw new Error(INVALID_PI_TASK_STORE);
	if (Array.isArray(parsed)) throw new Error(INVALID_PI_TASK_STORE);
	const data = parsed as Partial<PiTaskStoreData>;
	if (!Array.isArray(data.tasks)) throw new Error(INVALID_PI_TASK_STORE);
	const tasks = data.tasks.map(normalizeTask);
	const maxId = tasks.reduce((max, task) => {
		const value = Number(task.id);
		return Number.isInteger(value) && value > max ? value : max;
	}, 0);
	let nextId = maxId + 1;
	if (typeof data.nextId === "number") {
		const isIntegerNextId = Number.isInteger(data.nextId);
		const hasLargerNextId = isIntegerNextId && data.nextId > maxId;
		if (hasLargerNextId) nextId = data.nextId;
	}
	return { nextId, tasks };
}

export async function writePiTaskStore(
	path: string,
	data: PiTaskStoreData,
): Promise<void> {
	ensureFileBacked(path);
	await mkdir(dirname(path), { recursive: true });
	const temporary = `${path}.tmp`;
	await writeFile(temporary, JSON.stringify(data, null, 2), UTF8_ENCODING);
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

function metadataLines(task: PiTask): string[] {
	const lines = [`${PRIVATE_PREFIX}id=${task.id} -->`];
	const hasOwner: boolean = !!task.owner;
	if (hasOwner) lines.push(`${PRIVATE_PREFIX}owner=${task.owner} -->`);
	const hasBlockedTasks: boolean = !!task.blocks.length;
	if (hasBlockedTasks)
		lines.push(`${PRIVATE_PREFIX}blocks=${task.blocks.join(TEXT)} -->`);
	const hasBlockingTasks: boolean = !!task.blockedBy.length;
	if (hasBlockingTasks)
		lines.push(`${PRIVATE_PREFIX}blockedBy=${task.blockedBy.join(TEXT)} -->`);
	return lines;
}

function withoutPrivateLines(description: string): string {
	return description
		.split(/\r?\n/)
		.filter((line) => !line.trim().startsWith(PRIVATE_PREFIX))
		.join(TEXT_2)
		.trim();
}

function descriptionWithMetadata(task: PiTask): string {
	const original = withoutPrivateLines(task.description);
	const metadata = metadataLines(task);
	return original
		? `${original}\n${metadata.join(TEXT_2)}`
		: metadata.join(TEXT_2);
}

function parseStatus(content: string): {
	status: PiTask["status"];
	subject: string;
} {
	const marker = content.match(/^\[([ x~])\]\s*(.*)$/i);
	if (!marker) return { status: PENDING_VALUE, subject: content };
	const status =
		marker[1].toLowerCase() === X
			? COMPLETED_VALUE
			: marker[1] === TEXT_3
				? IN_PROGRESS_VALUE
				: PENDING_VALUE;
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
	return { clean: cleanLines.join(TEXT_2).trim(), values };
}

function flattened(children: readonly TodoistChild[]): TodoistChild[] {
	const result: TodoistChild[] = [];
	for (const child of children) {
		result.push(child);
		const children = child.children;
		if (!children) continue;
		result.push(...flattened(children));
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
		const needsTaskId: boolean = !!(!id || used.has(id));
		if (needsTaskId) {
			while (used.has(String(nextId))) nextId += 1;
			id = String(nextId);
		}
		used.add(id);
		const numericId = Number(id);
		const hasNumericTaskId: boolean = !!(
			Number.isInteger(numericId) && numericId >= nextId
		);
		if (hasNumericTaskId) nextId = numericId + 1;
		const blocks = metadata.values.blocks
			? metadata.values.blocks.split(TEXT).filter(Boolean)
			: [];
		const blockedBy = metadata.values.blockedBy
			? metadata.values.blockedBy.split(TEXT).filter(Boolean)
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
		content: `${task.status === COMPLETED_VALUE ? X_2 : task.status === IN_PROGRESS_VALUE ? TEXT_4 : TEXT_5} ${task.subject}`,
		description: descriptionWithMetadata(task),
	}));
}

class SyncCancelledError extends Error {
	constructor() {
		super(SYNCHRONIZATION_CANCELLED);
	}
}

export async function syncPiTasksToTodoist(
	client: TodoistClient,
	parentRef: string,
	store: PiTaskStoreData,
	isCurrent?: () => boolean,
): Promise<void> {
	const assertCurrent = (): void => {
		const isSyncCancelled: boolean = !!(isCurrent && !isCurrent());
		if (isSyncCancelled) throw new SyncCancelledError();
	};
	assertCurrent();
	const descendants = await client.listDescendants(parentRef);
	assertCurrent();
	await client.deleteDescendants(descendants);
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
): Promise<PiTaskStoreData> {
	const descendants = await client.listDescendants(parentRef);
	const store = todoistSubtasksToPiTasks(descendants);
	await writePiTaskStore(path, store);
	return store;
}
