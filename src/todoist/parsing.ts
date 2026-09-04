const STRING_LITERAL_1_REDACTED_4089B42A = "$1=[redacted]";
const STRING_LITERAL_INVALID_JSON_RESPONSE_384F0043 = "invalid JSON response";
const STRING_LITERAL_RESPONSE_74970FA5 = "response";
const STRING_LITERAL_UNEXPECTED_JSON_SHAPE_E8AE2192 = "unexpected JSON shape";
const STRING_LITERAL_TASK_HAS_MISSING_REQUIRED_FIELDS_BA147756 =
	"task has missing required fields";
const STRING_LITERAL_EXPECTED_A_LIST_PAYLOAD_301A8473 =
	"expected a list payload";
const STRING_LITERAL_HTTP = "http:";
const STRING_LITERAL_HTTPS = "https:";

import type { TodoistTask } from "./client.ts";
import { TodoistError } from "./errors.ts";

export function sanitizeError(stderr: string): string {
	return stderr
		.replace(
			/(?:token|password|secret|authorization|bearer)\s*[:=]?\s*[^\s,;]+/gi,
			STRING_LITERAL_1_REDACTED_4089B42A,
		)
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 300);
}

export function parsePayload(stdout: string, family: string): unknown {
	try {
		return JSON.parse(stdout);
	} catch {
		throw new TodoistError(
			family,
			STRING_LITERAL_INVALID_JSON_RESPONSE_384F0043,
		);
	}
}

export function record(value: unknown): Record<string, unknown> {
	if (typeof value !== "object") {
		throw new TodoistError(
			STRING_LITERAL_RESPONSE_74970FA5,
			STRING_LITERAL_UNEXPECTED_JSON_SHAPE_E8AE2192,
		);
	}
	if (value === null) {
		throw new TodoistError(
			STRING_LITERAL_RESPONSE_74970FA5,
			STRING_LITERAL_UNEXPECTED_JSON_SHAPE_E8AE2192,
		);
	}
	if (Array.isArray(value)) {
		throw new TodoistError(
			STRING_LITERAL_RESPONSE_74970FA5,
			STRING_LITERAL_UNEXPECTED_JSON_SHAPE_E8AE2192,
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
		const isHttp = url.protocol === STRING_LITERAL_HTTP;
		const isHttps = url.protocol === STRING_LITERAL_HTTPS;
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
		throw new TodoistError(
			STRING_LITERAL_RESPONSE_74970FA5,
			STRING_LITERAL_TASK_HAS_MISSING_REQUIRED_FIELDS_BA147756,
		);
	const hasContent = content !== "";
	if (!hasContent)
		throw new TodoistError(
			STRING_LITERAL_RESPONSE_74970FA5,
			STRING_LITERAL_TASK_HAS_MISSING_REQUIRED_FIELDS_BA147756,
		);
	const hasProjectId = projectId !== "";
	if (!hasProjectId)
		throw new TodoistError(
			STRING_LITERAL_RESPONSE_74970FA5,
			STRING_LITERAL_TASK_HAS_MISSING_REQUIRED_FIELDS_BA147756,
		);
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
	throw new TodoistError(
		STRING_LITERAL_RESPONSE_74970FA5,
		STRING_LITERAL_EXPECTED_A_LIST_PAYLOAD_301A8473,
	);
}
