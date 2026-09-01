const PI = ".pi";
const TASKS = "tasks";
const SYNCHRONIZATION_CANCELLED = "synchronization cancelled";

import { join, resolve } from "node:path";
import { writePiTaskStore } from "./pi-task-store.ts";
import {
	piTasksToTodoistSubtasks,
	todoistSubtasksToPiTasks,
} from "./pi-tasks-sync-helpers.ts";

export { readPiTaskStore, writePiTaskStore } from "./pi-task-store.ts";

export {
	piTasksToTodoistSubtasks,
	todoistSubtasksToPiTasks,
} from "./pi-tasks-sync-helpers.ts";

import type { TodoistClient } from "./todoist.ts";

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

export function sessionTaskPath(cwd: string, sessionId: string): string {
	return join(resolve(cwd), PI, TASKS, `tasks-${sessionId}.json`);
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
): Promise<PiTaskStoreData> {
	const descendants = await client.listDescendants(parentRef);
	const store = todoistSubtasksToPiTasks(descendants);
	await writePiTaskStore(path, store);
	return store;
}
