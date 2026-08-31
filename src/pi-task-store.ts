import {
	access,
	mkdir,
	readFile,
	rename,
	unlink,
	writeFile,
} from "node:fs/promises";
import { dirname } from "node:path";
import { normalizeTask } from "./pi-task-normalize.ts";
import type { PiTaskStoreData } from "./pi-tasks-sync.ts";

const OFF_VALUE = "off";
const MEMORY = "memory";
const UTF8_ENCODING = "utf8";
const PI_TASK_STORE_UNAVAILABLE =
	"Pi task store is unavailable in the configured memory/off scope";
const PI_TASK_STORE_INCOMPATIBLE =
	"Pi task store uses an incompatible configured path";
const PI_TASK_STORE_PATH_REQUIRED = "Pi task store path is required";
const INVALID_PI_TASK_STORE_JSON = "invalid Pi task store JSON";
const INVALID_PI_TASK_STORE = "invalid Pi task store";
const OBJECT_TYPE = "object";
const NUMBER_TYPE = "number";

function isNumber(value: unknown): value is number {
	return typeof value === NUMBER_TYPE;
}

function ensureFileBacked(path: string): void {
	const scope = (process.env.PI_TASKS ?? "").toLowerCase();
	const isUnavailable = scope === OFF_VALUE || scope === MEMORY;
	if (isUnavailable) throw new Error(PI_TASK_STORE_UNAVAILABLE);
	const hasIncompatiblePath =
		process.env.PI_TASK_LIST_ID !== undefined ||
		process.env.PI_TASKS_PATH !== undefined;
	if (hasIncompatiblePath) throw new Error(PI_TASK_STORE_INCOMPATIBLE);
	const isMissingPath = path === "";
	if (isMissingPath) throw new Error(PI_TASK_STORE_PATH_REQUIRED);
}

function maxTaskId(tasks: PiTaskStoreData["tasks"]): number {
	let max = 0;
	for (const task of tasks) {
		const value = Number(task.id);
		const isLargerInteger = Number.isInteger(value) && value > max;
		if (isLargerInteger) max = value;
	}
	return max;
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
	const isInvalidObject = typeof parsed !== OBJECT_TYPE || parsed === null;
	if (isInvalidObject) throw new Error(INVALID_PI_TASK_STORE);
	const isArray = Array.isArray(parsed);
	if (isArray) throw new Error(INVALID_PI_TASK_STORE);
	const data = parsed as Partial<PiTaskStoreData>;
	const taskData = data.tasks;
	const hasTasks = Array.isArray(taskData);
	if (!hasTasks) throw new Error(INVALID_PI_TASK_STORE);
	const tasks = taskData.map(normalizeTask);
	const maxId = maxTaskId(tasks);
	let nextId = maxId + 1;
	const nextIdValue = data.nextId;
	const hasNextId = isNumber(nextIdValue);
	if (hasNextId) {
		const isIntegerNextId = Number.isInteger(nextIdValue);
		const hasLargerNextId = isIntegerNextId && nextIdValue > maxId;
		if (hasLargerNextId) nextId = nextIdValue;
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
			/* preserve original rename error */
		}
		throw error;
	}
}
