import type { PiTask } from "./pi-tasks-sync.ts";

const PENDING_VALUE = "pending";
const IN_PROGRESS_VALUE = "in_progress";
const COMPLETED_VALUE = "completed";
const INVALID_PI_TASK_STORE_TASK = "invalid Pi task store task";
const STRING_TYPE = "string";
const NUMBER_TYPE = "number";
const OBJECT_TYPE = "object";

function isNumber(value: unknown): value is number {
	return typeof value === NUMBER_TYPE;
}

function requiredString(value: unknown): string {
	const isString = typeof value === STRING_TYPE;
	if (!isString) throw new Error(INVALID_PI_TASK_STORE_TASK);
	return value as string;
}

function metadataRecord(value: unknown): Record<string, unknown> {
	const isObject = typeof value === OBJECT_TYPE && value !== null;
	if (!isObject) return {};
	const isArray = Array.isArray(value);
	if (isArray) return {};
	return value as Record<string, unknown>;
}

function stringList(value: unknown): string[] {
	const isArray = Array.isArray(value);
	if (!isArray) return [];
	const result: string[] = [];
	for (const item of value) {
		const isString = typeof item === STRING_TYPE;
		if (isString) result.push(item);
	}
	return result;
}

export function normalizeTask(value: unknown): PiTask {
	const isInvalidObject = typeof value !== OBJECT_TYPE || value === null;
	if (isInvalidObject) throw new Error(INVALID_PI_TASK_STORE_TASK);
	const isArray = Array.isArray(value);
	if (isArray) throw new Error(INVALID_PI_TASK_STORE_TASK);
	const data = value as Partial<PiTask>;
	const id = requiredString(data.id);
	const subject = requiredString(data.subject);
	const description = requiredString(data.description);
	let status: PiTask["status"] = PENDING_VALUE;
	const isInProgress = data.status === IN_PROGRESS_VALUE;
	if (isInProgress) status = IN_PROGRESS_VALUE;
	const isCompleted = data.status === COMPLETED_VALUE;
	if (isCompleted) status = COMPLETED_VALUE;
	const now = Date.now();
	const activeForm = data.activeForm;
	const owner = data.owner;
	const createdAt = data.createdAt;
	const updatedAt = data.updatedAt;
	return {
		id,
		subject,
		description,
		status,
		activeForm: typeof activeForm === STRING_TYPE ? activeForm : undefined,
		owner: typeof owner === STRING_TYPE ? owner : undefined,
		metadata: metadataRecord(data.metadata),
		blocks: stringList(data.blocks),
		blockedBy: stringList(data.blockedBy),
		createdAt: isNumber(createdAt) ? createdAt : now,
		updatedAt: isNumber(updatedAt) ? updatedAt : now,
	};
}
