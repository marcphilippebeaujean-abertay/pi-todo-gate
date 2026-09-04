const TODOIST_ERROR_NAME = "TodoistError";
const PROJECT_COMMAND = "project";
const LIST_COMMAND = "list";
const JSON_FLAG = "--json";
const TASK_ID_PREFIX = "id:";
const PROJECT_LIST_FAMILY = "project list";
const TASK_COMMAND = "task";
const VIEW_COMMAND = "view";
const COMPLETE_COMMAND = "complete";
const TASK_CLAIM_FAMILY = "task claim";
const TASK_OUTSIDE_PROJECT_MESSAGE = "task is outside the configured project";
const SECTION_COMMAND = "section";
const PROJECT_FLAG = "--project";
const IN_PROGRESS_SECTION_NAME = "in progress";
const TASK_ALREADY_IN_PROGRESS_MESSAGE = "task is already in progress";
const MOVE_COMMAND = "move";
const SECTION_FLAG = "--section";
const IN_PROGRESS_SECTION_TITLE = "In Progress";

import type { CommandResult } from "../shared/command.ts";
import {
	canonicalTaskId,
	childList,
	parsePayload,
	record,
	sanitizeError,
	stringValue,
	taskFromPayload,
} from "./parsing.ts";

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

interface ClaimProject {
	id: string;
	currentTaskId?: string;
	allowInProgress?: boolean;
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

export class TodoistClient {
	constructor(private readonly exec: TodoistExec) {}

	private async run(
		args: readonly string[],
		parseJson = true,
	): Promise<unknown> {
		const result = await this.exec.run(args);
		const commandFailed = result.code !== 0;
		if (commandFailed) {
			const family = args.slice(0, 2).join(" ");
			throw new TodoistError(family, sanitizeError(result.stderr));
		}
		return parseJson
			? parsePayload(result.stdout, args.slice(0, 2).join(" "))
			: result.stdout;
	}

	async resolveProject(ref: string): Promise<{ id: string; name: string }> {
		const payload = await this.run([PROJECT_COMMAND, LIST_COMMAND, JSON_FLAG]);
		const rows = childList(payload).map(record);
		const hasIdPrefix = ref.startsWith(TASK_ID_PREFIX);
		const target = hasIdPrefix ? ref.slice(3) : ref;
		const match = rows.find(
			(row) =>
				stringValue(row.id) === target || stringValue(row.name) === target,
		);
		if (match === undefined)
			throw new TodoistError(
				PROJECT_LIST_FAMILY,
				`configured project not found: ${target}`,
			);
		return { id: stringValue(match.id), name: stringValue(match.name) };
	}

	async getTask(ref: string): Promise<TodoistTask> {
		const task = taskFromPayload(
			await this.run([TASK_COMMAND, VIEW_COMMAND, ref, JSON_FLAG]),
		);
		const hasNoUrl = !task.url && !task.webUrl;
		if (hasNoUrl) task.url = `https://app.todoist.com/app/task/${task.id}`;
		return task;
	}

	async completeTask(ref: string): Promise<void> {
		await this.run([TASK_COMMAND, COMPLETE_COMMAND, ref], false);
	}

	private async resolveSectionName(
		task: TodoistTask,
		projectId: string,
	): Promise<string | null | undefined> {
		let sectionName = task.sectionName;
		const needsSectionLookup = !sectionName && Boolean(task.sectionId);
		if (!needsSectionLookup) return sectionName;
		const sections = await this.run([
			SECTION_COMMAND,
			LIST_COMMAND,
			PROJECT_FLAG,
			`id:${projectId}`,
			JSON_FLAG,
		]);
		const section = childList(sections)
			.map(record)
			.find((item) => stringValue(item.id) === task.sectionId);
		const hasSection = section !== undefined;
		sectionName = hasSection ? stringValue(section.name) || null : null;
		return sectionName;
	}

	async claimTask(ref: string, project: ClaimProject): Promise<TodoistTask> {
		const task = await this.getTask(ref);
		const isOutsideProject = task.projectId !== project.id;
		if (isOutsideProject) {
			throw new TodoistError(TASK_CLAIM_FAMILY, TASK_OUTSIDE_PROJECT_MESSAGE);
		}
		let sectionName = await this.resolveSectionName(task, project.id);
		const isInProgress =
			sectionName?.trim().toLowerCase() === IN_PROGRESS_SECTION_NAME;
		const hasCurrentTaskId = project.currentTaskId !== undefined;
		const currentTaskId = hasCurrentTaskId
			? canonicalTaskId(project.currentTaskId as string)
			: undefined;
		const isCurrentTask = task.id === currentTaskId;
		const hasProgressCollision = isInProgress && !isCurrentTask;
		const shouldRejectCollision =
			hasProgressCollision && !project.allowInProgress;
		if (shouldRejectCollision)
			throw new TodoistError(
				TASK_CLAIM_FAMILY,
				TASK_ALREADY_IN_PROGRESS_MESSAGE,
			);
		if (!isInProgress) {
			await this.run(
				[
					TASK_COMMAND,
					MOVE_COMMAND,
					ref,
					SECTION_FLAG,
					IN_PROGRESS_SECTION_TITLE,
					PROJECT_FLAG,
					`id:${project.id}`,
				],
				false,
			);
			sectionName = IN_PROGRESS_SECTION_TITLE;
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
