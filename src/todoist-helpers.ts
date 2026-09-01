const TODOIST_ERROR_NAME = "TodoistError";
const REDACTED_VALUE = "$1=[redacted]";
const INVALID_JSON_RESPONSE = "invalid JSON response";
const RESPONSE = "response";
const UNEXPECTED_JSON_SHAPE = "unexpected JSON shape";
const HTTP = "http:";
const HTTPS = "https:";
const TASK_HAS_NO_ID = "task has no id";
const OBJECT_TYPE = "object";
const STRING_TYPE = "string";

import type { TodoistTask } from "./todoist.ts";

export class TodoistError extends Error {
	readonly commandFamily: string;

	constructor(commandFamily: string, detail: string) {
		super(`Todoist ${commandFamily} failed${detail ? `: ${detail}` : ""}`);
		this.name = TODOIST_ERROR_NAME;
		this.commandFamily = commandFamily;
	}
}

export function sanitizeError(stderr: string): string {
	return stderr
		.replace(
			/(?:token|password|secret|authorization|bearer)\s*[:=]?\s*[^\s,;]+/gi,
			REDACTED_VALUE,
		)
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 300);
}

export function parsePayload(stdout: string, family: string): unknown {
	try {
		return JSON.parse(stdout);
	} catch {
		throw new TodoistError(family, INVALID_JSON_RESPONSE);
	}
}

export function record(value: unknown): Record<string, unknown> {
	const isNotObject = typeof value !== OBJECT_TYPE;
	const isNull = value === null;
	const isInvalidObject = isNotObject || isNull;
	if (isInvalidObject) throw new TodoistError(RESPONSE, UNEXPECTED_JSON_SHAPE);
	const isArray = Array.isArray(value);
	if (isArray) throw new TodoistError(RESPONSE, UNEXPECTED_JSON_SHAPE);
	return value as Record<string, unknown>;
}

export function stringValue(value: unknown, fallback = ""): string {
	return typeof value === STRING_TYPE ? (value as string) : fallback;
}

export function safeHttpUrl(value: unknown): string | undefined {
	const isNotString = typeof value !== STRING_TYPE;
	if (isNotString) return undefined;
	try {
		const url = new URL(value as string);
		return url.protocol === HTTP || url.protocol === HTTPS
			? (value as string)
			: undefined;
	} catch {
		return undefined;
	}
}

export function nullableString(value: unknown): string | null | undefined {
	const isNull = value === null;
	if (isNull) return null;
	return typeof value === STRING_TYPE ? (value as string) : undefined;
}

export function taskFromPayload(value: unknown): TodoistTask {
	const data = record(value);
	const id = stringValue(data.id);
	const isMissingTaskId: boolean = !id;
	if (isMissingTaskId) throw new TodoistError(RESPONSE, TASK_HAS_NO_ID);
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

export function childList(value: unknown): unknown[] {
	const isArray = Array.isArray(value);
	if (isArray) return value;
	const data = record(value);
	const hasTasks = Array.isArray(data.tasks);
	if (hasTasks) return data.tasks as unknown[];
	const hasResults = Array.isArray(data.results);
	if (hasResults) return data.results as unknown[];
	throw new TodoistError(RESPONSE, UNEXPECTED_JSON_SHAPE);
}
