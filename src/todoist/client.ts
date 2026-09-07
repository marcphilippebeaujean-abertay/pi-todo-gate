const PROJECT = "project";
const LIST = "list";
const JSON_OUTPUT_FLAG = "--json";
const ID = "id:";
const PROJECT_LIST = "project list";
const TASK = "task";
const VIEW = "view";
const ADD = "add";
const COMPLETE = "complete";
const TASK_CLAIM = "task claim";
const TASK_IS_OUTSIDE_THE_CONFIGURED_PROJECT =
	"task is outside the configured project";
const SECTION = "section";
const PROJECT_FLAG = "--project";
const SECTION_FLAG = "--section";
const DESCRIPTION_FLAG = "--description";
const IN_PROGRESS_VALUE = "in progress";
const IN_PROGRESS_LABEL = "In Progress";
const MOVE = "move";

import type { CommandResult } from "../shared/command.ts";
import {
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

export type IsCurrentOperation = () => boolean;

import { TodoistError, TodoistOperationCancelled } from "./errors.ts";

export { TodoistError, TodoistOperationCancelled } from "./errors.ts";

export class TodoistClient {
	constructor(private readonly exec: TodoistExec) {}

	private async run(
		args: readonly string[],
		parseJson = true,
		isCurrent?: IsCurrentOperation,
	): Promise<unknown> {
		if (isCurrent !== undefined) {
			const isCurrentBeforeRun = isCurrent();
			if (!isCurrentBeforeRun) throw new TodoistOperationCancelled();
		}
		const result = await this.exec.run(args);
		if (isCurrent !== undefined) {
			const isCurrentAfterRun = isCurrent();
			if (!isCurrentAfterRun) throw new TodoistOperationCancelled();
		}
		const commandFailed = result.code !== 0;
		if (commandFailed) {
			const family = args.slice(0, 2).join(" ");
			throw new TodoistError(family, sanitizeError(result.stderr));
		}
		return parseJson
			? parsePayload(result.stdout, args.slice(0, 2).join(" "))
			: result.stdout;
	}

	async resolveProject(
		ref: string,
		isCurrent?: IsCurrentOperation,
	): Promise<{ id: string; name: string }> {
		const payload = await this.run(
			[PROJECT, LIST, JSON_OUTPUT_FLAG],
			true,
			isCurrent,
		);
		const rows = childList(payload).map(record);
		const hasIdPrefix = ref.startsWith(ID);
		const target = hasIdPrefix ? ref.slice(ID.length) : ref;
		const match = rows.find(
			(row) =>
				stringValue(row.id) === target || stringValue(row.name) === target,
		);
		const hasNoProjectMatch = match === undefined;
		if (hasNoProjectMatch)
			throw new TodoistError(
				PROJECT_LIST,
				`configured project not found: ${target}`,
			);
		return { id: stringValue(match.id), name: stringValue(match.name) };
	}

	async getTask(
		ref: string,
		isCurrent?: IsCurrentOperation,
	): Promise<TodoistTask> {
		const task = taskFromPayload(
			await this.run([TASK, VIEW, ref, JSON_OUTPUT_FLAG], true, isCurrent),
		);
		const hasNoTaskUrl = !task.url && !task.webUrl;
		if (hasNoTaskUrl) task.url = `https://app.todoist.com/app/task/${task.id}`;
		return task;
	}

	private async resolveSectionName(
		task: TodoistTask,
		projectId: string,
		isCurrent?: IsCurrentOperation,
	): Promise<string | null | undefined> {
		const hasSectionName = Boolean(task.sectionName);
		if (hasSectionName) return task.sectionName;
		const hasSectionId = Boolean(task.sectionId);
		if (!hasSectionId) return task.sectionName;
		const sections = await this.run(
			[SECTION, LIST, PROJECT_FLAG, `${ID}${projectId}`, JSON_OUTPUT_FLAG],
			true,
			isCurrent,
		);
		const section = childList(sections)
			.map(record)
			.find((item) => stringValue(item.id) === task.sectionId);
		const hasSection = section !== undefined;
		return hasSection ? stringValue(section.name) || null : null;
	}

	async claimTask(
		ref: string,
		project: { id: string },
		isCurrent?: IsCurrentOperation,
	): Promise<TodoistTask> {
		const task = await this.getTask(ref, isCurrent);
		const isOutsideProject = task.projectId !== project.id;
		if (isOutsideProject)
			throw new TodoistError(
				TASK_CLAIM,
				TASK_IS_OUTSIDE_THE_CONFIGURED_PROJECT,
			);
		let sectionName = await this.resolveSectionName(
			task,
			project.id,
			isCurrent,
		);
		const isInProgress =
			sectionName?.trim().toLowerCase() === IN_PROGRESS_VALUE;
		const needsInProgressMove = !isInProgress;
		if (needsInProgressMove) {
			await this.run(
				[
					TASK,
					MOVE,
					ref,
					SECTION_FLAG,
					IN_PROGRESS_LABEL,
					PROJECT_FLAG,
					`${ID}${project.id}`,
				],
				false,
				isCurrent,
			);
			sectionName = IN_PROGRESS_LABEL;
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

	async createTask(
		title: string,
		description: string,
		project: { id: string },
		isCurrent?: IsCurrentOperation,
	): Promise<TodoistTask> {
		const task = taskFromPayload(
			await this.run(
				[
					TASK,
					ADD,
					title,
					DESCRIPTION_FLAG,
					description,
					PROJECT_FLAG,
					`${ID}${project.id}`,
					SECTION_FLAG,
					IN_PROGRESS_LABEL,
					JSON_OUTPUT_FLAG,
				],
				true,
				isCurrent,
			),
		);
		return {
			...task,
			url:
				task.webUrl ??
				task.url ??
				`https://app.todoist.com/app/task/${task.id}`,
		};
	}

	async completeTask(
		ref: string,
		isCurrent?: IsCurrentOperation,
	): Promise<void> {
		await this.run([TASK, COMPLETE, ref], false, isCurrent);
	}
}
