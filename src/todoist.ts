const EMPTY_STRING = "";
const TODOISTERROR = "TodoistError";
const VALUE_1_REDACTED = "$1=[redacted]";
const SPACE = " ";
const INVALID_JSON_RESPONSE = "invalid JSON response";
const RESPONSE = "response";
const UNEXPECTED_JSON_SHAPE = "unexpected JSON shape";
const HTTP = "http:";
const HTTPS = "https:";
const TASK_HAS_NO_ID = "task has no id";
const PROJECT = "project";
const LIST = "list";
const JSON_2 = "--json";
const ID = "id:";
const PROJECT_LIST = "project list";
const TASK = "task";
const VIEW = "view";
const TASK_CLAIM = "task claim";
const TASK_IS_OUTSIDE_THE_CONFIGURED_PROJECT =
	"task is outside the configured project";
const SECTION = "section";
const PROJECT_2 = "--project";
const IN_PROGRESS_VALUE = "in progress";
const TASK_IS_ALREADY_IN_PROGRESS = "task is already in progress";
const IN_PROGRESS_VALUE_2 = "In Progress";
const MOVE = "move";
const SECTION_2 = "--section";
const COMPLETE = "complete";
const PARENT = "--parent";
const VALUE_DELETE = "delete";
const YES = "--yes";
const ADD = "add";
const DESCRIPTION = "--description";

import type { CommandResult } from "./git.ts";

export interface TodoistTask {
	id: string;
	content: string;
	description: string;
	projectId: string;
	sectionId?: string | null;
	sectionName?: string | null;
	parentId?: string | null;
	url?: string;
	webUrl?: string;
}

export interface TodoistChild extends TodoistTask {
	children?: TodoistChild[];
}

export interface TodoistExec {
	run(args: readonly string[]): Promise<CommandResult>;
}

export class TodoistError extends Error {
	readonly commandFamily: string;

	constructor(commandFamily: string, detail: string) {
		super(
			`Todoist ${commandFamily} failed${detail ? `: ${detail}` : EMPTY_STRING}`,
		);
		this.name = TODOISTERROR;
		this.commandFamily = commandFamily;
	}
}

function sanitizeError(stderr: string): string {
	return stderr
		.replace(
			/(?:token|password|secret|authorization|bearer)\s*[:=]?\s*[^\s,;]+/gi,
			VALUE_1_REDACTED,
		)
		.replace(/\s+/g, SPACE)
		.trim()
		.slice(0, 300);
}

function parsePayload(stdout: string, family: string): unknown {
	try {
		return JSON.parse(stdout);
	} catch {
		throw new TodoistError(family, INVALID_JSON_RESPONSE);
	}
}

function record(value: unknown): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new TodoistError(RESPONSE, UNEXPECTED_JSON_SHAPE);
	}
	return value as Record<string, unknown>;
}

function stringValue(value: unknown, fallback = EMPTY_STRING): string {
	return typeof value === "string" ? value : fallback;
}

function safeHttpUrl(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	try {
		const url = new URL(value);
		return url.protocol === HTTP || url.protocol === HTTPS ? value : undefined;
	} catch {
		return undefined;
	}
}

function nullableString(value: unknown): string | null | undefined {
	if (value === null) return null;
	return typeof value === "string" ? value : undefined;
}

function taskFromPayload(value: unknown): TodoistTask {
	const data = record(value);
	const id = stringValue(data.id);
	if (!id) throw new TodoistError(RESPONSE, TASK_HAS_NO_ID);
	return {
		id,
		content: stringValue(data.content),
		description: stringValue(data.description),
		projectId: stringValue(data.projectId ?? data.project_id),
		sectionId: nullableString(data.sectionId ?? data.section_id),
		sectionName: nullableString(data.sectionName ?? data.section_name),
		parentId: nullableString(data.parentId ?? data.parent_id),
		url: safeHttpUrl(data.url),
		webUrl: safeHttpUrl(data.webUrl ?? data.web_url),
	};
}

function childList(value: unknown): unknown[] {
	if (Array.isArray(value)) return value;
	const data = record(value);
	if (Array.isArray(data.tasks)) return data.tasks;
	return Array.isArray(data.results) ? data.results : [];
}

export class TodoistClient {
	constructor(private readonly exec: TodoistExec) {}

	private async run(
		args: readonly string[],
		parseJson = true,
	): Promise<unknown> {
		const result = await this.exec.run(args);
		if (result.code !== 0) {
			const family = args.slice(0, 2).join(SPACE);
			throw new TodoistError(family, sanitizeError(result.stderr));
		}
		return parseJson
			? parsePayload(result.stdout, args.slice(0, 2).join(SPACE))
			: result.stdout;
	}

	async resolveProject(ref: string): Promise<{ id: string; name: string }> {
		const payload = await this.run([PROJECT, LIST, JSON_2]);
		const rows = childList(payload).map(record);
		const target = ref.startsWith(ID) ? ref.slice(3) : ref;
		const match = rows.find(
			(row) =>
				stringValue(row.id) === target || stringValue(row.name) === target,
		);
		if (!match)
			throw new TodoistError(
				PROJECT_LIST,
				`configured project not found: ${target}`,
			);
		return { id: stringValue(match.id), name: stringValue(match.name) };
	}

	async getTask(ref: string): Promise<TodoistTask> {
		const task = taskFromPayload(await this.run([TASK, VIEW, ref, JSON_2]));
		if (!task.url && !task.webUrl)
			task.url = `https://app.todoist.com/app/task/${task.id}`;
		return task;
	}

	async claimTask(
		ref: string,
		project: { id: string; currentTaskId?: string },
	): Promise<TodoistTask> {
		const task = await this.getTask(ref);
		if (task.projectId !== project.id) {
			throw new TodoistError(
				TASK_CLAIM,
				TASK_IS_OUTSIDE_THE_CONFIGURED_PROJECT,
			);
		}
		let sectionName = task.sectionName;
		if (!sectionName && task.sectionId) {
			const sections = await this.run([
				SECTION,
				LIST,
				PROJECT_2,
				`id:${project.id}`,
				JSON_2,
			]);
			const section = childList(sections)
				.map(record)
				.find((item) => stringValue(item.id) === task.sectionId);
			sectionName = section ? stringValue(section.name) || null : null;
		}
		const isInProgress =
			sectionName?.trim().toLowerCase() === IN_PROGRESS_VALUE;
		if (isInProgress && task.id !== project.currentTaskId) {
			throw new TodoistError(TASK_CLAIM, TASK_IS_ALREADY_IN_PROGRESS);
		}
		if (sectionName !== IN_PROGRESS_VALUE_2) {
			await this.run(
				[
					TASK,
					MOVE,
					ref,
					SECTION_2,
					IN_PROGRESS_VALUE_2,
					PROJECT_2,
					`id:${project.id}`,
				],
				false,
			);
			sectionName = IN_PROGRESS_VALUE_2;
		}
		return {
			...task,
			sectionName,
			url:
				task.webUrl ??
				task.url ??
				`https://app.todoist.com/app/task/${task.id}`,
		};
	}

	async completeTask(ref: string): Promise<void> {
		await this.run([TASK, COMPLETE, ref]);
	}

	async listDescendants(ref: string): Promise<TodoistChild[]> {
		const payload = await this.run([TASK, LIST, PARENT, ref, JSON_2]);
		const children: TodoistChild[] = [];
		for (const item of childList(payload)) {
			const child = taskFromPayload(item) as TodoistChild;
			child.children = await this.listDescendants(child.id);
			children.push(child);
		}
		return children;
	}

	async deleteDescendants(children: readonly TodoistChild[]): Promise<void> {
		for (const child of children) {
			if (child.children?.length) await this.deleteDescendants(child.children);
			await this.run([TASK, VALUE_DELETE, `id:${child.id}`, YES]);
		}
	}

	async createSubtask(
		parentRef: string,
		input: { content: string; description: string },
	): Promise<TodoistTask> {
		return taskFromPayload(
			await this.run([
				TASK,
				ADD,
				input.content,
				PARENT,
				parentRef,
				DESCRIPTION,
				input.description,
				JSON_2,
			]),
		);
	}
}
