const EMPTY_STRING = "";
const SPACE = " ";
const VALUE_42 = "42";
const IMPLEMENT_FEATURE = "Implement feature";
const DETAILS = "Details";
const PROJECT_1 = "project-1";
const TODO = "Todo";
const HTTPS_TODOIST_COM_SHOWTASK_ID_42 = "https://todoist.com/showTask?id=42";
const RESOLVES_PROJECTS_BY_NAME_AND_ID = "resolves projects by name and id";
const VALUE_1 = "1";
const MERGE_TD = "Merge TD";
const ID_1 = "id:1";
const REJECTS_A_TASK_OUTSIDE_THE_CONFIGURED_PROJECT =
	"rejects a task outside the configured project";
const OTHER = "other";
const CONFIGURED_PROJECT = "configured project";
const ACCEPTS_ANOTHER_TASK_ALREADY_IN_PROGRESS =
	"accepts another task already in progress";
const IN_PROGRESS_VALUE = "In Progress";
const RESOLVES_SECTION_NAMES_THROUGH_SUPPORTED_TD_SECTION =
	"resolves section names through supported td section list";
const SECTION_1 = "section-1";
const IN_PROGRESS_VALUE_2 = "In progress";
const PREFERS_WEBURL_WHEN_RETURNING_A_CANONICAL_CLAIMED =
	"prefers webUrl when returning a canonical claimed-task URL";
const HTTPS_APP_TODOIST_COM_APP_TASK_42 = "https://app.todoist.com/app/task/42";
const TASK_MOVED_SUCCESSFULLY = "Task moved successfully";
const CREATES_TASK_WITH_DESCRIPTION = "creates a task with a description";
const ADD = "add";
const DESCRIPTION = "--description";
const TASK_COMPLETED_SUCCESSFULLY = "Task completed successfully";
const DOES_NOT_MOVE_CANCELLED_CLAIM = "does not move cancelled claim";
const ACCEPTS_THE_ALREADY_CLAIMED_TASK_AND_MOVES =
	"accepts the already claimed task and moves a valid task";
const TASK = "task";
const VIEW = "view";
const JSON_2 = "--json";
const MOVE = "move";
const SECTION = "--section";
const PROJECT = "--project";
const ID_PROJECT_1 = "id:project-1";
const REJECTS_UNSAFE_URL_SCHEMES_FROM_CLI_DATA =
	"rejects unsafe URL schemes from CLI data";
const JAVASCRIPT_ALERT_1 = "javascript:alert(1)";
const VALUE_8_EVIL = "\u001b]8;;evil";
const USES_WEBURL_BEFORE_URL_AND_CONSTRUCTS_A =
	"uses webUrl before url and constructs a fallback URL";
const COMPLETES_TASKS_WITH_SEPARATE_ARGUMENTS =
	"completes tasks with separate arguments";
const ID_42 = "id:42";
const COMPLETE = "complete";
const RETURNS_A_TYPED_SANITIZED_ERROR_FOR_FAILED =
	"returns a typed sanitized error for failed CLI commands";
const TOKEN_SUPER_SECRET_FAILED = "token=super-secret failed";
const SUPER_SECRET = "super-secret";
const TASK_COMPLETE = "task complete";

import { describe, expect, it } from "vitest";
import type { CommandResult } from "../../src/git.ts";
import {
	TodoistClient,
	TodoistError,
	type TodoistExec,
	TodoistOperationCancelled,
} from "../../src/todoist/client.ts";

const ok = (value: unknown): CommandResult => ({
	stdout: JSON.stringify(value),
	stderr: EMPTY_STRING,
	code: 0,
});
const okText = (stdout: string): CommandResult => ({
	stdout,
	stderr: EMPTY_STRING,
	code: 0,
});
const fail = (stderr: string): CommandResult => ({
	stdout: EMPTY_STRING,
	stderr,
	code: 1,
});

function fakeTodoist(responses: Record<string, CommandResult>): {
	exec: TodoistExec;
	calls: string[][];
} {
	const calls: string[][] = [];
	return {
		calls,
		exec: {
			run: async (args) => {
				calls.push([...args]);
				return (
					responses[args.join(SPACE)] ?? fail(`unexpected ${args.join(SPACE)}`)
				);
			},
		},
	};
}

const task = (overrides: Record<string, unknown> = {}) => ({
	id: VALUE_42,
	content: IMPLEMENT_FEATURE,
	description: DETAILS,
	projectId: PROJECT_1,
	sectionName: TODO,
	url: HTTPS_TODOIST_COM_SHOWTASK_ID_42,
	...overrides,
});

describe("TodoistClient", () => {
	it(RESOLVES_PROJECTS_BY_NAME_AND_ID, async () => {
		const byName = fakeTodoist({
			"project list --json": ok({
				results: [{ id: VALUE_1, name: MERGE_TD }],
			}),
		});
		await expect(
			new TodoistClient(byName.exec).resolveProject(MERGE_TD),
		).resolves.toEqual({
			id: VALUE_1,
			name: MERGE_TD,
		});

		const byId = fakeTodoist({
			"project list --json": ok({
				results: [{ id: VALUE_1, name: MERGE_TD }],
			}),
		});
		await expect(
			new TodoistClient(byId.exec).resolveProject(ID_1),
		).resolves.toEqual({
			id: VALUE_1,
			name: MERGE_TD,
		});
	});

	it(REJECTS_A_TASK_OUTSIDE_THE_CONFIGURED_PROJECT, async () => {
		const fake = fakeTodoist({
			"task view 42 --json": ok(task({ projectId: OTHER })),
		});
		await expect(
			new TodoistClient(fake.exec).claimTask(VALUE_42, {
				id: PROJECT_1,
			}),
		).rejects.toThrow(CONFIGURED_PROJECT);
	});

	it(ACCEPTS_ANOTHER_TASK_ALREADY_IN_PROGRESS, async () => {
		const fake = fakeTodoist({
			"task view 42 --json": ok(task({ sectionName: IN_PROGRESS_VALUE })),
		});
		await expect(
			new TodoistClient(fake.exec).claimTask(VALUE_42, {
				id: PROJECT_1,
			}),
		).resolves.toMatchObject({ id: VALUE_42 });
	});

	it(RESOLVES_SECTION_NAMES_THROUGH_SUPPORTED_TD_SECTION, async () => {
		const fake = fakeTodoist({
			"task view 42 --json": ok(
				task({ sectionName: undefined, sectionId: SECTION_1 }),
			),
			"section list --project id:project-1 --json": ok({
				results: [{ id: SECTION_1, name: IN_PROGRESS_VALUE_2 }],
			}),
		});
		await expect(
			new TodoistClient(fake.exec).claimTask(VALUE_42, {
				id: PROJECT_1,
			}),
		).resolves.toMatchObject({ id: VALUE_42 });
	});

	it(PREFERS_WEBURL_WHEN_RETURNING_A_CANONICAL_CLAIMED, async () => {
		const fake = fakeTodoist({
			"task view 42 --json": ok(
				task({
					webUrl: HTTPS_APP_TODOIST_COM_APP_TASK_42,
					url: HTTPS_TODOIST_COM_SHOWTASK_ID_42,
				}),
			),
			"task move 42 --section In Progress --project id:project-1": okText(
				TASK_MOVED_SUCCESSFULLY,
			),
		});
		await expect(
			new TodoistClient(fake.exec).claimTask(VALUE_42, {
				id: PROJECT_1,
			}),
		).resolves.toMatchObject({
			url: HTTPS_APP_TODOIST_COM_APP_TASK_42,
		});
	});

	it(ACCEPTS_THE_ALREADY_CLAIMED_TASK_AND_MOVES, async () => {
		const fake = fakeTodoist({
			"task view 42 --json": ok(task({ sectionName: TODO })),
			"task move 42 --section In Progress --project id:project-1": ok({}),
		});
		await expect(
			new TodoistClient(fake.exec).claimTask(VALUE_42, {
				id: PROJECT_1,
			}),
		).resolves.toMatchObject({ id: VALUE_42 });
		expect(fake.calls).toEqual([
			[TASK, VIEW, VALUE_42, JSON_2],
			[TASK, MOVE, VALUE_42, SECTION, IN_PROGRESS_VALUE, PROJECT, ID_PROJECT_1],
		]);
	});

	it(REJECTS_UNSAFE_URL_SCHEMES_FROM_CLI_DATA, async () => {
		const fake = fakeTodoist({
			"task view 42 --json": ok(
				task({ url: JAVASCRIPT_ALERT_1, webUrl: VALUE_8_EVIL }),
			),
		});
		const result = await new TodoistClient(fake.exec).getTask(VALUE_42);
		expect(result.url).toBe(HTTPS_APP_TODOIST_COM_APP_TASK_42);
		expect(result.webUrl).toBeUndefined();
	});

	it(USES_WEBURL_BEFORE_URL_AND_CONSTRUCTS_A, async () => {
		const web = fakeTodoist({
			"task view 42 --json": ok(
				task({ webUrl: HTTPS_APP_TODOIST_COM_APP_TASK_42 }),
			),
		});
		await expect(
			new TodoistClient(web.exec).getTask(VALUE_42),
		).resolves.toMatchObject({ webUrl: HTTPS_APP_TODOIST_COM_APP_TASK_42 });

		const fallback = fakeTodoist({
			"task view 42 --json": ok(task({ url: undefined, webUrl: undefined })),
		});
		await expect(
			new TodoistClient(fallback.exec).getTask(VALUE_42),
		).resolves.toMatchObject({ url: HTTPS_APP_TODOIST_COM_APP_TASK_42 });
	});

	it(DOES_NOT_MOVE_CANCELLED_CLAIM, async () => {
		const fake = fakeTodoist({
			"task view 42 --json": ok(task({ sectionName: TODO })),
		});
		let checks = 0;
		const isCurrent = () => {
			checks += 1;
			return checks < 3;
		};
		await expect(
			new TodoistClient(fake.exec).claimTask(
				VALUE_42,
				{ id: PROJECT_1 },
				isCurrent,
			),
		).rejects.toBeInstanceOf(TodoistOperationCancelled);
		expect(fake.calls).toEqual([[TASK, VIEW, VALUE_42, JSON_2]]);
	});

	it(CREATES_TASK_WITH_DESCRIPTION, async () => {
		const fake = fakeTodoist({
			"task add Implement feature --description Details --project id:project-1 --section In Progress --json":
				ok(task({ id: "43", sectionName: IN_PROGRESS_VALUE })),
		});
		await expect(
			new TodoistClient(fake.exec).createTask(IMPLEMENT_FEATURE, DETAILS, {
				id: PROJECT_1,
			}),
		).resolves.toMatchObject({ id: "43", content: IMPLEMENT_FEATURE });
		expect(fake.calls).toEqual([
			[
				TASK,
				ADD,
				IMPLEMENT_FEATURE,
				DESCRIPTION,
				DETAILS,
				PROJECT,
				ID_PROJECT_1,
				SECTION,
				IN_PROGRESS_VALUE,
				JSON_2,
			],
		]);
	});

	it(COMPLETES_TASKS_WITH_SEPARATE_ARGUMENTS, async () => {
		const fake = fakeTodoist({
			"task complete id:42": okText(TASK_COMPLETED_SUCCESSFULLY),
		});
		await expect(
			new TodoistClient(fake.exec).completeTask(ID_42),
		).resolves.toBeUndefined();
		expect(fake.calls).toEqual([[TASK, COMPLETE, ID_42]]);
	});

	it(RETURNS_A_TYPED_SANITIZED_ERROR_FOR_FAILED, async () => {
		const fake = fakeTodoist({
			"task complete 42": fail(TOKEN_SUPER_SECRET_FAILED),
		});
		const error = await new TodoistClient(fake.exec)
			.completeTask(VALUE_42)
			.catch((value: unknown) => value);
		expect(error).toBeInstanceOf(TodoistError);
		expect((error as Error).message).not.toContain(SUPER_SECRET);
		expect((error as Error).message).toContain(TASK_COMPLETE);
	});
});
