const STRING_LITERAL_TODOISTERROR_F35F50B5 = "TodoistError";
const STRING_LITERAL_1_REDACTED_4089B42A = "$1=[redacted]";
const STRING_LITERAL_INVALID_JSON_RESPONSE_384F0043 = "invalid JSON response";
const STRING_LITERAL_RESPONSE_74970FA5 = "response";
const STRING_LITERAL_UNEXPECTED_JSON_SHAPE_E8AE2192 = "unexpected JSON shape";
const STRING_LITERAL_TASK_HAS_MISSING_REQUIRED_FIELDS_BA147756 =
	"task has missing required fields";
const STRING_LITERAL_EXPECTED_A_LIST_PAYLOAD_301A8473 =
	"expected a list payload";
const STRING_LITERAL_PROJECT_67DBF477 = "project";
const STRING_LITERAL_LIST_53A8C595 = "list";
const STRING_LITERAL_JSON_3C44146C = "--json";
const STRING_LITERAL_ID_F94F1F69 = "id:";
const STRING_LITERAL_PROJECT_LIST_3D60951A = "project list";
const STRING_LITERAL_TASK_B8A94174 = "task";
const STRING_LITERAL_VIEW_5E44D2A2 = "view";
const STRING_LITERAL_COMPLETE_4DB320F6 = "complete";
const STRING_LITERAL_TASK_CLAIM_8F24CDE6 = "task claim";
const STRING_LITERAL_TASK_IS_OUTSIDE_THE_CONFIGURED_05550446 =
	"task is outside the configured project";
const STRING_LITERAL_SECTION_D7526181 = "section";
const STRING_LITERAL_PROJECT_F844796C = "--project";
const STRING_LITERAL_IN_PROGRESS_587BFFEA = "in progress";
const STRING_LITERAL_TASK_IS_ALREADY_IN_PROGRESS_ED73545E =
	"task is already in progress";
const STRING_LITERAL_MOVE_D72C4D1E = "move";
const STRING_LITERAL_SECTION_7E3A0078 = "--section";
const STRING_LITERAL_IN_PROGRESS_940FF43E = "In Progress";

import type { CommandResult } from "../shared/command.ts";

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

export interface TodoistExec {
	run(args: readonly string[]): Promise<CommandResult>;
}

export class TodoistError extends Error {
	readonly commandFamily: string;

	constructor(commandFamily: string, detail: string) {
		super(`Todoist ${commandFamily} failed${detail ? `: ${detail}` : ""}`);
		this.name = STRING_LITERAL_TODOISTERROR_F35F50B5;
		this.commandFamily = commandFamily;
	}
}

function sanitizeError(stderr: string): string {
	return stderr
		.replace(
			/(?:token|password|secret|authorization|bearer)\s*[:=]?\s*[^\s,;]+/gi,
			STRING_LITERAL_1_REDACTED_4089B42A,
		)
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 300);
}

function parsePayload(stdout: string, family: string): unknown {
	try {
		return JSON.parse(stdout);
	} catch {
		throw new TodoistError(
			family,
			STRING_LITERAL_INVALID_JSON_RESPONSE_384F0043,
		);
	}
}

function record(value: unknown): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new TodoistError(
			STRING_LITERAL_RESPONSE_74970FA5,
			STRING_LITERAL_UNEXPECTED_JSON_SHAPE_E8AE2192,
		);
	}
	return value as Record<string, unknown>;
}

function stringValue(value: unknown, fallback = ""): string {
	return typeof value === "string" ? value : fallback;
}

function safeHttpUrl(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	try {
		const url = new URL(value);
		return url.protocol === "http:" || url.protocol === "https:"
			? value
			: undefined;
	} catch {
		return undefined;
	}
}

function canonicalTaskId(ref: string): string {
	return ref.trim().replace(/^id:/, "");
}

function nullableString(value: unknown): string | null | undefined {
	if (value === null) return null;
	return typeof value === "string" ? value : undefined;
}

function taskFromPayload(value: unknown): TodoistTask {
	const data = record(value);
	const id = stringValue(data.id);
	const content = stringValue(data.content);
	const projectId = stringValue(data.projectId ?? data.project_id);
	if (!id || !content || !projectId)
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

function childList(value: unknown): unknown[] {
	if (Array.isArray(value)) return value;
	const data = record(value);
	if (Array.isArray(data.tasks)) return data.tasks;
	if (Array.isArray(data.results)) return data.results;
	throw new TodoistError(
		STRING_LITERAL_RESPONSE_74970FA5,
		STRING_LITERAL_EXPECTED_A_LIST_PAYLOAD_301A8473,
	);
}

export class TodoistClient {
	constructor(private readonly exec: TodoistExec) {}

	private async run(
		args: readonly string[],
		parseJson = true,
	): Promise<unknown> {
		const result = await this.exec.run(args);
		if (result.code !== 0) {
			const family = args.slice(0, 2).join(" ");
			throw new TodoistError(family, sanitizeError(result.stderr));
		}
		return parseJson
			? parsePayload(result.stdout, args.slice(0, 2).join(" "))
			: result.stdout;
	}

	async resolveProject(ref: string): Promise<{ id: string; name: string }> {
		const payload = await this.run([
			STRING_LITERAL_PROJECT_67DBF477,
			STRING_LITERAL_LIST_53A8C595,
			STRING_LITERAL_JSON_3C44146C,
		]);
		const rows = childList(payload).map(record);
		const target = ref.startsWith(STRING_LITERAL_ID_F94F1F69)
			? ref.slice(3)
			: ref;
		const match = rows.find(
			(row) =>
				stringValue(row.id) === target || stringValue(row.name) === target,
		);
		if (!match)
			throw new TodoistError(
				STRING_LITERAL_PROJECT_LIST_3D60951A,
				`configured project not found: ${target}`,
			);
		return { id: stringValue(match.id), name: stringValue(match.name) };
	}

	async getTask(ref: string): Promise<TodoistTask> {
		const task = taskFromPayload(
			await this.run([
				STRING_LITERAL_TASK_B8A94174,
				STRING_LITERAL_VIEW_5E44D2A2,
				ref,
				STRING_LITERAL_JSON_3C44146C,
			]),
		);
		if (!task.url && !task.webUrl)
			task.url = `https://app.todoist.com/app/task/${task.id}`;
		return task;
	}

	async completeTask(ref: string): Promise<void> {
		await this.run(
			[STRING_LITERAL_TASK_B8A94174, STRING_LITERAL_COMPLETE_4DB320F6, ref],
			false,
		);
	}

	async claimTask(
		ref: string,
		project: {
			id: string;
			currentTaskId?: string;
			allowInProgress?: boolean;
		},
	): Promise<TodoistTask> {
		const task = await this.getTask(ref);
		if (task.projectId !== project.id) {
			throw new TodoistError(
				STRING_LITERAL_TASK_CLAIM_8F24CDE6,
				STRING_LITERAL_TASK_IS_OUTSIDE_THE_CONFIGURED_05550446,
			);
		}
		let sectionName = task.sectionName;
		if (!sectionName && task.sectionId) {
			const sections = await this.run([
				STRING_LITERAL_SECTION_D7526181,
				STRING_LITERAL_LIST_53A8C595,
				STRING_LITERAL_PROJECT_F844796C,
				`id:${project.id}`,
				STRING_LITERAL_JSON_3C44146C,
			]);
			const section = childList(sections)
				.map(record)
				.find((item) => stringValue(item.id) === task.sectionId);
			sectionName = section ? stringValue(section.name) || null : null;
		}
		const isInProgress =
			sectionName?.trim().toLowerCase() === STRING_LITERAL_IN_PROGRESS_587BFFEA;
		const currentTaskId = project.currentTaskId
			? canonicalTaskId(project.currentTaskId)
			: undefined;
		if (isInProgress && task.id !== currentTaskId && !project.allowInProgress) {
			throw new TodoistError(
				STRING_LITERAL_TASK_CLAIM_8F24CDE6,
				STRING_LITERAL_TASK_IS_ALREADY_IN_PROGRESS_ED73545E,
			);
		}
		if (!isInProgress) {
			await this.run(
				[
					STRING_LITERAL_TASK_B8A94174,
					STRING_LITERAL_MOVE_D72C4D1E,
					ref,
					STRING_LITERAL_SECTION_7E3A0078,
					STRING_LITERAL_IN_PROGRESS_940FF43E,
					STRING_LITERAL_PROJECT_F844796C,
					`id:${project.id}`,
				],
				false,
			);
			sectionName = STRING_LITERAL_IN_PROGRESS_940FF43E;
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
}
