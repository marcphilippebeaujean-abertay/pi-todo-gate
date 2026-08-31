import type { PiTask, PiTaskStoreData } from "./pi-tasks-sync.ts";
import type { TodoistChild } from "./todoist.ts";

const PENDING_VALUE = "pending";
const IN_PROGRESS_VALUE = "in_progress";
const COMPLETED_VALUE = "completed";
const PRIVATE_PREFIX = "<!-- pi-todo-gate:";
const PRIVATE_LINE = /^<!-- pi-todo-gate:([a-zA-Z]+)=(.*?) -->$/;
const COMPLETED_MARKER = "[x]";
const IN_PROGRESS_MARKER = "[~]";
const PENDING_MARKER = "[ ]";

function metadataLines(task: PiTask): string[] {
	const lines = [`${PRIVATE_PREFIX}id=${task.id} -->`];
	const hasOwner = !!task.owner;
	if (hasOwner) lines.push(`${PRIVATE_PREFIX}owner=${task.owner} -->`);
	const hasBlockedTasks = !!task.blocks.length;
	if (hasBlockedTasks)
		lines.push(`${PRIVATE_PREFIX}blocks=${task.blocks.join(",")} -->`);
	const hasBlockingTasks = !!task.blockedBy.length;
	if (hasBlockingTasks)
		lines.push(`${PRIVATE_PREFIX}blockedBy=${task.blockedBy.join(",")} -->`);
	return lines;
}

function withoutPrivateLines(description: string): string {
	const lines: string[] = [];
	for (const line of description.split(/\r?\n/)) {
		const isPrivate = line.trim().startsWith(PRIVATE_PREFIX);
		if (!isPrivate) lines.push(line);
	}
	return lines.join("\n").trim();
}

function descriptionWithMetadata(task: PiTask): string {
	const original = withoutPrivateLines(task.description);
	const metadata = metadataLines(task).join("\n");
	return original ? `${original}\n${metadata}` : metadata;
}

function parseStatus(content: string): {
	status: PiTask["status"];
	subject: string;
} {
	const marker = content.match(/^\[([ x~])\]\s*(.*)$/i);
	const hasMarker = marker !== null;
	if (!hasMarker) return { status: PENDING_VALUE, subject: content };
	const markerValue = marker[1].toLowerCase();
	const isCompleted = markerValue === "x";
	const isInProgress = markerValue === "~";
	const status = isCompleted
		? COMPLETED_VALUE
		: isInProgress
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
		const hasMatch = match !== null;
		if (hasMatch) values[match[1]] = match[2];
		else cleanLines.push(line);
	}
	return { clean: cleanLines.join("\n").trim(), values };
}

function flattened(children: readonly TodoistChild[]): TodoistChild[] {
	const result: TodoistChild[] = [];
	for (const child of children) {
		result.push(child);
		const nestedChildren = child.children;
		const hasChildren = nestedChildren !== undefined;
		if (hasChildren) result.push(...flattened(nestedChildren));
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
		const needsTaskId = !id || used.has(id);
		if (needsTaskId) {
			while (used.has(String(nextId))) nextId += 1;
			id = String(nextId);
		}
		used.add(id);
		const numericId = Number(id);
		const hasNumericTaskId = Number.isInteger(numericId) && numericId >= nextId;
		if (hasNumericTaskId) nextId = numericId + 1;
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
	const result: Array<{ content: string; description: string }> = [];
	for (const task of tasks) {
		const marker =
			task.status === COMPLETED_VALUE
				? COMPLETED_MARKER
				: task.status === IN_PROGRESS_VALUE
					? IN_PROGRESS_MARKER
					: PENDING_MARKER;
		result.push({
			content: `${marker} ${task.subject}`,
			description: descriptionWithMetadata(task),
		});
	}
	return result;
}
