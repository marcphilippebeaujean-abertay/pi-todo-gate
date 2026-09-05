const REDACTED_VALUE_REPLACEMENT = "$1=[redacted]";
const INVALID_JSON_RESPONSE_MESSAGE = "invalid JSON response";
const RESPONSE_ERROR_FAMILY = "response";
const UNEXPECTED_JSON_SHAPE_MESSAGE = "unexpected JSON shape";
const MISSING_TASK_FIELDS_MESSAGE = "task has missing required fields";
const EXPECTED_LIST_PAYLOAD_MESSAGE = "expected a list payload";

import { TodoistError, type TodoistTask } from "./client.ts";

export function sanitizeError(stderr: string): string {
	return stderr
		.replace(
			/(?:token|password|secret|authorization|bearer)\s*[:=]?\s*[^\s,;]+/gi,
			REDACTED_VALUE_REPLACEMENT,
		)
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 300);
}

export function parsePayload(stdout: string, family: string): unknown {
	try {
		return JSON.parse(stdout);
	} catch {
		throw new TodoistError(family, INVALID_JSON_RESPONSE_MESSAGE);
	}
}

export function record(value: unknown): Record<string, unknown> {
	if (typeof value !== "object") {
		throw new TodoistError(
			RESPONSE_ERROR_FAMILY,
			UNEXPECTED_JSON_SHAPE_MESSAGE,
		);
	}
	if (value === null) {
		throw new TodoistError(
			RESPONSE_ERROR_FAMILY,
			UNEXPECTED_JSON_SHAPE_MESSAGE,
		);
	}
	if (Array.isArray(value)) {
		throw new TodoistError(
			RESPONSE_ERROR_FAMILY,
			UNEXPECTED_JSON_SHAPE_MESSAGE,
		);
	}
	return value as Record<string, unknown>;
}

export function stringValue(value: unknown, fallback = ""): string {
	return typeof value === "string" ? value : fallback;
}

export function safeHttpUrl(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	try {
		const url = new URL(value);
		const protocol = url.protocol;
		const isHttp = protocol === "http:";
		const isHttps = protocol === "https:";
		const isUnsupportedProtocol = !isHttp && !isHttps;
		if (isUnsupportedProtocol) return undefined;
		return value;
	} catch {
		return undefined;
	}
}

export function canonicalTaskId(ref: string): string {
	return ref.trim().replace(/^id:/, "");
}

function nullableString(value: unknown): string | null | undefined {
	if (value === null) return null;
	return typeof value === "string" ? value : undefined;
}

export function taskFromPayload(value: unknown): TodoistTask {
	const data = record(value);
	const id = stringValue(data.id);
	const content = stringValue(data.content);
	const projectId = stringValue(data.projectId ?? data.project_id);
	const hasId = id !== "";
	if (!hasId)
		throw new TodoistError(RESPONSE_ERROR_FAMILY, MISSING_TASK_FIELDS_MESSAGE);
	const hasContent = content !== "";
	if (!hasContent)
		throw new TodoistError(RESPONSE_ERROR_FAMILY, MISSING_TASK_FIELDS_MESSAGE);
	const hasProjectId = projectId !== "";
	if (!hasProjectId)
		throw new TodoistError(RESPONSE_ERROR_FAMILY, MISSING_TASK_FIELDS_MESSAGE);
	return {
		id,
		content,
		description: stringValue(data.description),
		projectId,
		sectionId: nullableString(data.sectionId ?? data.section_id),
		sectionName: nullableString(data.sectionName ?? data.section_name),
		url: safeHttpUrl(data.url),
		webUrl: safeHttpUrl(data.webUrl ?? data.web_url),
	};
}

export function childList(value: unknown): unknown[] {
	if (Array.isArray(value)) return value;
	const data = record(value);
	if (Array.isArray(data.tasks)) return data.tasks;
	if (Array.isArray(data.results)) return data.results;
	throw new TodoistError(RESPONSE_ERROR_FAMILY, EXPECTED_LIST_PAYLOAD_MESSAGE);
}
