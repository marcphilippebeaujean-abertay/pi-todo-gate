const STRING_LITERAL_TODOISTERROR_F35F50B5 = "TodoistError";
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
		this.name = STRING_LITERAL_TODOISTERROR_F35F50B5;
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
		const payload = await this.run([
			STRING_LITERAL_PROJECT_67DBF477,
			STRING_LITERAL_LIST_53A8C595,
			STRING_LITERAL_JSON_3C44146C,
		]);
		const rows = childList(payload).map(record);
		const hasIdPrefix = ref.startsWith(STRING_LITERAL_ID_F94F1F69);
		const target = hasIdPrefix ? ref.slice(3) : ref;
		const match = rows.find(
			(row) =>
				stringValue(row.id) === target || stringValue(row.name) === target,
		);
		if (match === undefined)
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
		const hasNoUrl = !task.url && !task.webUrl;
		if (hasNoUrl) task.url = `https://app.todoist.com/app/task/${task.id}`;
		return task;
	}

	async completeTask(ref: string): Promise<void> {
		await this.run(
			[STRING_LITERAL_TASK_B8A94174, STRING_LITERAL_COMPLETE_4DB320F6, ref],
			false,
		);
	}

	private async resolveSectionName(
		task: TodoistTask,
		projectId: string,
	): Promise<string | null | undefined> {
		let sectionName = task.sectionName;
		const needsSectionLookup = !sectionName && Boolean(task.sectionId);
		if (!needsSectionLookup) return sectionName;
		const sections = await this.run([
			STRING_LITERAL_SECTION_D7526181,
			STRING_LITERAL_LIST_53A8C595,
			STRING_LITERAL_PROJECT_F844796C,
			`id:${projectId}`,
			STRING_LITERAL_JSON_3C44146C,
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
			throw new TodoistError(
				STRING_LITERAL_TASK_CLAIM_8F24CDE6,
				STRING_LITERAL_TASK_IS_OUTSIDE_THE_CONFIGURED_05550446,
			);
		}
		let sectionName = await this.resolveSectionName(task, project.id);
		const isInProgress =
			sectionName?.trim().toLowerCase() === STRING_LITERAL_IN_PROGRESS_587BFFEA;
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
				STRING_LITERAL_TASK_CLAIM_8F24CDE6,
				STRING_LITERAL_TASK_IS_ALREADY_IN_PROGRESS_ED73545E,
			);
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
