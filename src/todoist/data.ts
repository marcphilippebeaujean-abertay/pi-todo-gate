import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { isPathAtOrBelow, normalizedPath } from "../shared/path.ts";
import { textFromAssistantMessage } from "../shared/pi-worker.ts";
import { isRecord } from "../shared/records.ts";
import {
	CLAIM,
	CONFIG_FILE_NAME,
	ERROR,
	EXPECTED_LIST_PAYLOAD_MESSAGE,
	INVALID_JSON_RESPONSE_MESSAGE,
	INVALID_RESULT,
	MISSING_TASK_FIELDS_MESSAGE,
	OPERATION_CANCELLED,
	REDACTED_VALUE_REPLACEMENT,
	RESPONSE_ERROR_FAMILY,
	TODOIST_ERROR_NAME,
	UNEXPECTED_JSON_SHAPE_MESSAGE,
} from "./constants.ts";

export interface TodoistTask {
	id: string;
	content: string;
	description: string;
	projectId: string;
	sectionId?: string | null;
	sectionName?: string | null;
	url?: string;
	webUrl?: string;
}

export type TaskClaimWorker = (
	input: TaskClaimWorkerInput,
) => Promise<TaskClaimWorkerResult>;

export const TaskClaimWorkerInputSchema = Type.Object({
	sessionId: Type.String({ minLength: 1 }),
	prompt: Type.String(),
	cwd: Type.String(),
	projectRef: Type.String(),
	prRef: Type.Union([Type.String(), Type.Null()]),
	worktree: Type.Object({
		isWorktree: Type.Boolean(),
		root: Type.Union([Type.String(), Type.Null()]),
		branch: Type.Union([Type.String(), Type.Null()]),
	}),
});

export type TaskClaimWorkerInput = Type.Static<
	typeof TaskClaimWorkerInputSchema
>;

export const TaskDataSchema = Type.Object({
	title: Type.String({ minLength: 1 }),
	description: Type.String(),
	id: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
});

export const TaskClaimWorkerResultSchema = Type.Object({
	sessionId: Type.String({ minLength: 1 }),
	action: Type.Union([Type.Literal("error"), Type.Literal("claim")]),
	taskData: Type.Union([TaskDataSchema, Type.Null()]),
	error: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
});

export type TaskClaimWorkerResult = Type.Static<
	typeof TaskClaimWorkerResultSchema
>;

export interface TodoistProjectSettings {
	todoistProjectRef: string;
	triggersOnlyOnWorktree?: boolean;
}

export interface TodoistProjectMapping {
	projects: Record<string, string | TodoistProjectSettings>;
}

export interface ResolvedProject {
	codingRoot: string;
	todoistProjectRef: string;
	triggersOnlyOnWorktree?: boolean;
}

export function defaultConfigPath(): string {
	const agentDir =
		process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
	return join(agentDir, CONFIG_FILE_NAME);
}

export const DEFAULT_CONFIG_PATH = defaultConfigPath();

export function parseConfig(raw: string): TodoistProjectMapping {
	try {
		const parsed: unknown = JSON.parse(raw);
		const isConfigRecord = isRecord(parsed);
		const record = isConfigRecord ? parsed : null;
		if (record === null) return { projects: {} };
		const isProjectRecord = isRecord(record.projects);
		const projectRecord = isProjectRecord ? record.projects : null;
		if (projectRecord === null) return { projects: {} };

		const projects: Record<string, string | TodoistProjectSettings> = {};
		for (const [path, project] of Object.entries(
			projectRecord as Record<string, unknown>,
		)) {
			const entry = parseProjectEntry(path, project);
			if (entry === null) continue;
			projects[entry[0]] = entry[1];
		}
		return { projects };
	} catch {
		return { projects: {} };
	}
}

export async function loadConfig(
	path = defaultConfigPath(),
): Promise<TodoistProjectMapping> {
	try {
		return parseConfig(await readFile(path, "utf8"));
	} catch {
		return { projects: {} };
	}
}

export function resolveConfiguredProject(
	cwd: string,
	config: TodoistProjectMapping,
): ResolvedProject | null {
	const current = normalizedPath(cwd);
	const candidates = Object.entries(config.projects)
		.map(([codingRoot, project]) => {
			const isStringProject = typeof project === "string";
			const todoistProjectRef = isStringProject
				? project
				: project.todoistProjectRef;
			const triggersOnlyOnWorktree = isStringProject
				? true
				: project.triggersOnlyOnWorktree !== false;
			return {
				codingRoot: normalizedPath(codingRoot),
				todoistProjectRef,
				triggersOnlyOnWorktree,
			};
		})
		.filter(({ codingRoot }) => isPathAtOrBelow(current, codingRoot))
		.sort((a, b) => b.codingRoot.length - a.codingRoot.length);

	const match = candidates[0];
	const hasMatch = match !== undefined;
	return hasMatch ? match : null;
}

export function configPathForAgentDir(agentDir: string): string {
	const isAbsoluteAgentDir = isAbsolute(agentDir);
	const resolvedAgentDir = isAbsoluteAgentDir ? agentDir : resolve(agentDir);
	return join(resolvedAgentDir, CONFIG_FILE_NAME);
}

export function parentDirectory(path: string): string {
	return dirname(normalizedPath(path));
}

export type ProjectEntry = string | TodoistProjectSettings;

export function parseProjectEntry(
	path: string,
	project: unknown,
): [string, ProjectEntry] | null {
	const normalizedPath = path.trim();
	const hasPath = normalizedPath !== "";
	if (!hasPath) return null;
	if (typeof project === "string") {
		const normalizedProject = project.trim();
		const hasProject = normalizedProject !== "";
		if (!hasProject) return null;
		return [normalizedPath, normalizedProject];
	}
	const isObjectProject = isRecord(project);
	const objectProject = isObjectProject ? project : null;
	if (objectProject === null) return null;
	const projectRef = objectProject.todoistProjectRef;
	if (typeof projectRef !== "string") return null;
	const hasProjectRef = projectRef.trim() !== "";
	if (!hasProjectRef) return null;
	const hasTriggerSetting =
		typeof objectProject.triggersOnlyOnWorktree === "boolean";
	const triggerSetting = hasTriggerSetting
		? {
				triggersOnlyOnWorktree: objectProject.triggersOnlyOnWorktree as boolean,
			}
		: {};
	return [
		normalizedPath,
		{
			todoistProjectRef: projectRef.trim(),
			...triggerSetting,
		},
	];
}

export class TodoistOperationCancelled extends Error {
	constructor() {
		super(OPERATION_CANCELLED);
	}
}

export class TodoistError extends Error {
	readonly commandFamily: string;

	constructor(commandFamily: string, detail: string) {
		const hasDetail = detail !== "";
		const detailSuffix = hasDetail ? `: ${detail}` : "";
		super(`Todoist ${commandFamily} failed${detailSuffix}`);
		this.name = TODOIST_ERROR_NAME;
		this.commandFamily = commandFamily;
	}
}

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
export const TODOIST_STATE_TYPE = "pi-todoist-gate-state";

export interface TodoistState {
	taskRef?: string;
	taskName?: string;
	taskUrl?: string;
	mergePromptedPrUrl?: string;
}

const STATE_KEYS = new Set<keyof TodoistState>([
	"taskRef",
	"taskName",
	"taskUrl",
	"mergePromptedPrUrl",
]);

export function isTodoistState(value: unknown): value is TodoistState {
	const isObject = typeof value === "object";
	if (!isObject) return false;
	if (value === null) return false;
	if (Array.isArray(value)) return false;
	const record = value as Record<string, unknown>;
	return Object.entries(record).every(
		([key, item]) =>
			STATE_KEYS.has(key as keyof TodoistState) && typeof item === "string",
	);
}

export function applyTodoistStatePatch(
	state: TodoistState,
	patch: Partial<TodoistState>,
): TodoistState {
	const next = { ...state };
	for (const key of STATE_KEYS) {
		const hasKey = Object.hasOwn(patch, key);
		if (!hasKey) continue;
		const value = patch[key];
		if (value === undefined) delete next[key];
		else next[key] = value;
	}
	return next;
}

const EMPTY = String();

function invalidResult(sessionId: string): TaskClaimWorkerResult {
	return { sessionId, action: ERROR, taskData: null, error: INVALID_RESULT };
}

function isValidActionData(result: TaskClaimWorkerResult): boolean {
	const hasTaskData = result.taskData !== null;
	const hasError = result.error !== null;
	const action = result.action;
	const isErrorAction = action === ERROR;
	if (isErrorAction) return !hasTaskData && hasError;
	const hasInvalidTaskData = !hasTaskData;
	if (hasInvalidTaskData) return false;
	if (hasError) return false;
	const taskData = result.taskData;
	const hasMissingTaskData = taskData === null;
	if (hasMissingTaskData) return false;
	const hasId = taskData.id !== null;
	const isClaimAction = action === CLAIM;
	return isClaimAction && hasId;
}

function parseCandidate(text: string): TaskClaimWorkerResult | undefined {
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	const hasInvalidBounds = start < 0 || end <= start;
	if (hasInvalidBounds) return undefined;
	try {
		const value: unknown = JSON.parse(text.slice(start, end + 1));
		const isSchemaResult = Value.Check(TaskClaimWorkerResultSchema, value);
		const hasInvalidSchemaResult = !isSchemaResult;
		if (hasInvalidSchemaResult) return undefined;
		const result = value as TaskClaimWorkerResult;
		const isValidResult = isValidActionData(result);
		if (!isValidResult) return undefined;
		return result;
	} catch {
		return undefined;
	}
}

function assistantTexts(stdout: string): string[] {
	const texts: string[] = [];
	for (const line of stdout.split(/\r?\n/)) {
		try {
			const event = JSON.parse(line) as { message?: unknown };
			const text = textFromAssistantMessage(event.message, EMPTY);
			const hasText = text !== EMPTY;
			if (hasText) texts.push(text);
		} catch {
			// Ignore non-JSON process output.
		}
	}
	return texts;
}

export function parseResult(
	stdout: string,
	sessionId = EMPTY,
): TaskClaimWorkerResult {
	const texts = assistantTexts(stdout);
	for (let index = texts.length - 1; index >= 0; index -= 1) {
		const result = parseCandidate(texts[index].trim());
		const hasResult = result !== undefined;
		if (hasResult) return result;
	}
	return invalidResult(sessionId);
}
