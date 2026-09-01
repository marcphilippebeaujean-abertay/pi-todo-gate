const PROJECT = "project";
const LIST = "list";
const JSON_OUTPUT_FLAG = "--json";
const ID = "id:";
const PROJECT_LIST = "project list";
const TASK = "task";
const VIEW = "view";
const TASK_CLAIM = "task claim";
const TASK_IS_OUTSIDE_THE_CONFIGURED_PROJECT =
	"task is outside the configured project";
const SECTION = "section";
const PROJECT_FLAG = "--project";
const IN_PROGRESS_VALUE = "in progress";
const TASK_IS_ALREADY_IN_PROGRESS = "task is already in progress";
const TODOIST_IN_PROGRESS_LABEL = "In Progress";
const MOVE = "move";
const SECTION_FLAG = "--section";
const COMPLETE = "complete";
const OPERATION_CANCELLED = "Todoist operation cancelled";

import type { CommandResult } from "./git.ts";
import {
	childList,
	parsePayload,
	record,
	sanitizeError,
	stringValue,
	TodoistError,
	taskFromPayload,
} from "./todoist-helpers.ts";

export { TodoistError };

export class TodoistOperationCancelled extends Error {
	constructor() {
		super(OPERATION_CANCELLED);
	}
}

export type IsCurrentOperation = () => boolean;

function assertCurrent(isCurrent?: IsCurrentOperation): void {
	const hasCurrentCheck = isCurrent !== undefined;
	if (!hasCurrentCheck) return;
	const operationIsCurrent = isCurrent();
	if (!operationIsCurrent) throw new TodoistOperationCancelled();
}

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

export interface TodoistExec {
	run(args: readonly string[]): Promise<CommandResult>;
}

export class TodoistClient {
	constructor(private readonly exec: TodoistExec) {}

	private async run(
		args: readonly string[],
		parseJson = true,
		isCurrent?: IsCurrentOperation,
	): Promise<unknown> {
		assertCurrent(isCurrent);
		const result = await this.exec.run(args);
		assertCurrent(isCurrent);
		const commandFailed: boolean = !!(result.code !== 0);
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
		const target = ref.startsWith(ID) ? ref.slice(3) : ref;
		let match: Record<string, unknown> | undefined;
		for (const row of rows) {
			const isMatchingProject =
				stringValue(row.id) === target || stringValue(row.name) === target;
			if (isMatchingProject) {
				match = row;
				break;
			}
		}
		const hasNoProjectMatch = !match;
		if (hasNoProjectMatch)
			throw new TodoistError(
				PROJECT_LIST,
				`configured project not found: ${target}`,
			);
		const projectMatch = match as Record<string, unknown>;
		return {
			id: stringValue(projectMatch.id),
			name: stringValue(projectMatch.name),
		};
	}

	async getTask(
		ref: string,
		isCurrent?: IsCurrentOperation,
	): Promise<TodoistTask> {
		const task = taskFromPayload(
			await this.run([TASK, VIEW, ref, JSON_OUTPUT_FLAG], true, isCurrent),
		);
		const hasNoTaskUrl: boolean = !!(!task.url && !task.webUrl);
		if (hasNoTaskUrl) task.url = `https://app.todoist.com/app/task/${task.id}`;
		return task;
	}

	private async resolveClaimSection(
		task: TodoistTask,
		project: { id: string },
		isCurrent?: IsCurrentOperation,
	): Promise<string | null | undefined> {
		const hasSectionName = Boolean(task.sectionName);
		if (hasSectionName) return task.sectionName;
		const hasSectionId = Boolean(task.sectionId);
		if (!hasSectionId) return task.sectionName;
		const sections = await this.run(
			[SECTION, LIST, PROJECT_FLAG, `id:${project.id}`, JSON_OUTPUT_FLAG],
			true,
			isCurrent,
		);
		let section: Record<string, unknown> | undefined;
		for (const item of childList(sections).map(record)) {
			const isMatchingSection = stringValue(item.id) === task.sectionId;
			if (isMatchingSection) {
				section = item;
				break;
			}
		}
		return section ? stringValue(section.name) || null : null;
	}

	async claimTask(
		ref: string,
		project: { id: string; currentTaskId?: string },
		isCurrent?: IsCurrentOperation,
	): Promise<TodoistTask> {
		const task = await this.getTask(ref, isCurrent);
		const isOutsideConfiguredProject = task.projectId !== project.id;
		if (isOutsideConfiguredProject) {
			throw new TodoistError(
				TASK_CLAIM,
				TASK_IS_OUTSIDE_THE_CONFIGURED_PROJECT,
			);
		}
		let sectionName = await this.resolveClaimSection(task, project, isCurrent);
		const isInProgress =
			sectionName?.trim().toLowerCase() === IN_PROGRESS_VALUE;
		const isClaimedByAnotherTask =
			isInProgress && task.id !== project.currentTaskId;
		if (isClaimedByAnotherTask) {
			throw new TodoistError(TASK_CLAIM, TASK_IS_ALREADY_IN_PROGRESS);
		}
		const needsInProgressMove = sectionName !== TODOIST_IN_PROGRESS_LABEL;
		if (needsInProgressMove) {
			await this.run(
				[
					TASK,
					MOVE,
					ref,
					SECTION_FLAG,
					TODOIST_IN_PROGRESS_LABEL,
					PROJECT_FLAG,
					`id:${project.id}`,
				],
				false,
				isCurrent,
			);
			sectionName = TODOIST_IN_PROGRESS_LABEL;
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

	async completeTask(
		ref: string,
		isCurrent?: IsCurrentOperation,
	): Promise<void> {
		await this.run([TASK, COMPLETE, ref], false, isCurrent);
	}
}
