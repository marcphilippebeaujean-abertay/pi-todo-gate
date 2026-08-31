const PRINT = "print";
const SESSION_CURRENT = "session-current";
const SESSIONS_CURRENT_JSONL = "/sessions/current.jsonl";
const SESSIONS = "/sessions";
const EMPTY_STRING = "";
const SESSION_START = "session_start";
const STARTUP = "startup";
const DOES_NOT_REGISTER_TOOLS_OR_PERFORM_EXTERNAL =
	"does not register tools or perform external work for an unmatched project";
const UNCONFIGURED_PROJECT = "/unconfigured/project";
const MERGE_TD = "merge-td";
const REGISTERS_THE_STATE_TOOL_ONLY_FOR_A =
	"registers the state tool only for a matched project";
const CONFIGURED_PROJECT = "/configured/project";
const PI_TODO_GATE_STATE = "pi_todo_gate_state";
const KEEPS_NATIVE_FOOTER_AND_PUBLISHES_PR_TASK =
	"keeps native footer and publishes PR/task statuses";
const TUI = "tui";
const PI_TODO_GATE_PR = "pi-todo-gate-pr";
const PR_LINK_NONE = "| PR Link: none |";
const PI_TODO_GATE_TASK = "pi-todo-gate-task";
const TODOIST_TASK_NONE = "Todoist Task: none";
const READS_THE_TASK_STORE_FROM_THE_ACTIVE =
	"reads the task store from the active worktree";
const PI_TODO_GATE_PROJECT = "pi-todo-gate-project-";
const WORKTREES = ".worktrees";
const DIALOG_EDIT = "dialog-edit";
const CUSTOM = "custom";
const PI_TODO_GATE_STATE_2 = "pi-todo-gate-state";
const PARENT = "parent";
const HTTPS_APP_TODOIST_COM_APP_TASK_PARENT =
	"https://app.todoist.com/app/task/parent";
const VALUE_1 = "1";
const WORKTREE_TASK = "Worktree task";
const PENDING_VALUE = "pending";
const AGENT_SETTLED = "agent_settled";
const PARENT_WORKTREE_TASK = "parent:[ ] Worktree task";
const LINKS_A_CLAIMED_TASK_FROM_SESSION_HISTORY =
	"links a claimed task from session history and refreshes the footer";
const PI_TODO_GATE_AUTO_LINK = "pi-todo-gate-auto-link-";
const MESSAGE = "message";
const ASSISTANT = "assistant";
const TEXT_CONTENT_TYPE = "text";
const CLAIMED_TODOIST_TASK_HTTPS_APP_TODOIST_COM =
	"Claimed Todoist task https://app.todoist.com/app/task/42";
const PROJECT_1 = "project-1";
const VALUE_42 = "42";
const IMPLEMENT_FEATURE = "Implement feature";
const HTTPS_APP_TODOIST_COM_APP_TASK_42 = "https://app.todoist.com/app/task/42";
const IMPLEMENT_FEATU = "Implement featu...";
const LINKS_A_TASK_URL_FROM_HISTORY_WHEN =
	"links a task URL from history when the current prompt confirms the claim";
const PI_TODO_GATE_PROMPT_LINK = "pi-todo-gate-prompt-link-";
const TODOIST_TASK_URL_HTTPS_APP_TODOIST_COM =
	"Todoist task URL: https://app.todoist.com/app/task/42";
const BEFORE_AGENT_START = "before_agent_start";
const CLAIMED_TODOIST_TASK_FOR_THIS_SESSION =
	"Claimed Todoist task for this session.";
const LINKS_A_SUCCESSFULLY_MOVED_TASK_AS_SOON =
	"links a successfully moved task as soon as its tool result arrives";
const PI_TODO_GATE_TOOL_LINK = "pi-todo-gate-tool-link-";
const TOOL_RESULT = "tool_result";
const BASH = "bash";
const TD_TASK_VIEW_42 = "td task view 42";
const TODOIST_TASK_IS_CLAIMED_42 = "Todoist task is claimed: 42";
const DOES_NOT_TREAT_THE_MISSING_TASK_WARNING =
	"does not treat the missing-task warning as a claim";
const PI_TODO_GATE_NEGATIVE_LINK = "pi-todo-gate-negative-link-";
const YOU_HAVE_NO_CLAIMED_A_TODOIST_TASK =
	"You have no claimed a Todoist task yet!";
const WARNS_ON_EVERY_PROMPT_ONLY_WHEN_NO =
	"warns on every prompt only when no task is active";
const WORK = "work";
const YOU_HAVE_NO_CLAIMED_A_TODOIST_TASK_2 =
	"you have no claimed a todoist task yet!";
const DISCOVERS_THE_FIRST_PR_URL_AND_IGNORES =
	"discovers the first PR URL and ignores later URLs";
const USER = "user";
const HTTPS_GITHUB_COM_O_R_PULL_1 = "https://github.com/o/r/pull/1";
const MESSAGE_END = "message_end";
const HTTPS_GITHUB_COM_O_R_PULL_2 = "https://github.com/o/r/pull/2";
const HTTPS_GITHUB_COM_O_R_PULL_3 = "https://github.com/o/r/pull/3";
const NEVER_SENDS_SYNCHRONIZATION_MESSAGES_TO_THE_AGENT =
	"never sends synchronization messages to the agent";
const VALIDATES_AND_PERSISTS_AN_EXPLICIT_PR_OVERRIDE =
	"validates and persists an explicit PR override";
const OLD = "old";
const CALL = "call";
const SET_PR = "set_pr";
const HTTPS_GITHUB_COM_O_R_PULL_42 = "https://github.com/o/r/pull/42?tab=files";
const HTTPS_GITHUB_COM_O_R_PULL_42_2 = "https://github.com/o/r/pull/42";
const PR_LINK = "PR Link:";
const CLEANS_UP_CONFIGURED_UI_WHEN_A_SESSION =
	"cleans up configured UI when a session becomes inactive";
const RESUME = "resume";
const UNCONFIGURED = "/unconfigured";
const DOES_NOT_INHERIT_STATE_FROM_ANOTHER_CODING =
	"does not inherit state from another coding project";
const CONFIGURED = "/configured";
const CHILD = "child";
const PREVIOUS = "previous";
const SESSIONS_PREVIOUS_JSONL = "/sessions/previous.jsonl";
const CLEARING_A_TASK_CLEARS_ITS_COMPLETION_METADATA =
	"clearing a task clears its completion metadata";
const PI_TODO_GATE_EXTENSION = "pi-todo-gate-extension-";
const TASK_1 = "task-1";
const CLEAR_TASK = "clear_task";
const DOES_NOT_RUN_A_PENDING_OLD_PARENT =
	"does not run a pending old-parent sync after switching tasks";
const SET_TASK = "set_task";
const VALUE_NEW = "new";
const LIST_NEW = "list:new";
const RECORDS_FAILED_TODOIST_COMPLETION_ATTEMPTS =
	"records failed Todoist completion attempts";
const TODOIST_UNAVAILABLE = "Todoist unavailable";
const FEATURE_AUTH = "feature/auth";
const GIT_MERGE_FEATURE_AUTH = "git merge feature/auth";
const DOES_NOT_OUTBOUND_SYNC_AFTER_AN_INBOUND =
	"does not outbound-sync after an inbound restore failure";
const RESTORE_FAILED = "restore failed";
const SWITCHES_TASKS_ONLY_AFTER_LOADING_THE_NEW =
	"switches tasks only after loading the new parent's subtasks";
const HTTPS_APP_TODOIST_COM_APP_TASK_OLD =
	"https://app.todoist.com/app/task/old";
const ADD_DIALOG_CONTROLS = "Add dialog controls";
const NEW_CHILD = "new-child";
const NEW_CHILD_2 = "[ ] New child";
const NEW_PARENT = "new-parent";
const LIST_NEW_PARENT = "list:new-parent";
const HTTPS_APP_TODOIST_COM_APP_TASK_NEW =
	"https://app.todoist.com/app/task/new-parent";
const NEW_CHILD_3 = "New child";
const REJECTS_INVALID_PR_URLS_WITHOUT_PERSISTING_THEM =
	"rejects invalid PR URLs without persisting them";
const HTTPS_EXAMPLE_COM_PR_42 = "https://example.com/pr/42";

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import extension from "../extensions/pi-todo-gate.ts";
import {
	readPiTaskStore,
	sessionTaskPath,
	writePiTaskStore,
} from "../src/pi-tasks-sync.ts";

function harness(cwd: string, branch: unknown[] = []) {
	const handlers = new Map<
		string,
		(event: any, ctx: any) => Promise<any> | any
	>();
	const tools: any[] = [];
	const appended: unknown[] = [];
	const notifications: string[] = [];
	const footerCalls: unknown[] = [];
	const statusCalls: Array<{ key: string; text: string | undefined }> = [];
	const pi: any = {
		on: (event: string, handler: any) => handlers.set(event, handler),
		registerTool: (tool: any) => tools.push(tool),
		appendEntry: (type: string, data: unknown) => appended.push({ type, data }),
	};
	const ctx: any = {
		cwd,
		mode: PRINT,
		ui: {
			theme: { fg: (_color: string, text: string) => text },
			notify: (message: string) => notifications.push(message),
			setFooter: (factory: unknown) => footerCalls.push(factory),
			setStatus: (key: string, text: string | undefined) =>
				statusCalls.push({ key, text }),
		},
		sessionManager: {
			getBranch: () => branch,
			getSessionId: () => SESSION_CURRENT,
			getSessionFile: () => SESSIONS_CURRENT_JSONL,
			getSessionDir: () => SESSIONS,
		},
		exec: async () => ({
			stdout: EMPTY_STRING,
			stderr: EMPTY_STRING,
			code: 0,
		}),
	};
	return {
		pi,
		ctx,
		handlers,
		tools,
		appended,
		notifications,
		footerCalls,
		statusCalls,
	};
}

const config = (projects: Record<string, string>) => ({ projects });

async function start(
	h: ReturnType<typeof harness>,
	projects: Record<string, string>,
) {
	extension(h.pi, {
		loadConfig: async () => config(projects),
	});
	await h.handlers.get(SESSION_START)?.(
		{ type: SESSION_START, reason: STARTUP },
		h.ctx,
	);
}

describe("lazy activation", () => {
	it(DOES_NOT_REGISTER_TOOLS_OR_PERFORM_EXTERNAL, async () => {
		const h = harness(UNCONFIGURED_PROJECT);
		await start(h, { "/configured": MERGE_TD });
		expect(h.tools).toHaveLength(0);
		expect(h.appended).toHaveLength(0);
	});

	it(REGISTERS_THE_STATE_TOOL_ONLY_FOR_A, async () => {
		const h = harness(CONFIGURED_PROJECT);
		await start(h, { "/configured": MERGE_TD });
		expect(h.tools.map((tool) => tool.name)).toEqual([PI_TODO_GATE_STATE]);
	});

	it(KEEPS_NATIVE_FOOTER_AND_PUBLISHES_PR_TASK, async () => {
		const h = harness(CONFIGURED_PROJECT);
		h.ctx.mode = TUI;
		await start(h, { "/configured": MERGE_TD });
		expect(h.footerCalls).toEqual([undefined]);
		expect(h.statusCalls).toEqual([
			{ key: PI_TODO_GATE_PR, text: PR_LINK_NONE },
			{ key: PI_TODO_GATE_TASK, text: TODOIST_TASK_NONE },
		]);
	});
});

describe("task synchronization", () => {
	it(READS_THE_TASK_STORE_FROM_THE_ACTIVE, async () => {
		const configuredRoot = await mkdtemp(join(tmpdir(), PI_TODO_GATE_PROJECT));
		const worktree = join(configuredRoot, WORKTREES, DIALOG_EDIT);
		const h = harness(worktree, [
			{
				type: CUSTOM,
				customType: PI_TODO_GATE_STATE_2,
				data: {
					taskRef: PARENT,
					taskUrl: HTTPS_APP_TODOIST_COM_APP_TASK_PARENT,
				},
			},
		]);
		const created: string[] = [];
		const client: any = {
			listDescendants: async () => [],
			deleteDescendants: async () => {},
			createSubtask: async (parent: string, task: { content: string }) => {
				created.push(`${parent}:${task.content}`);
			},
		};
		extension(h.pi, {
			loadConfig: async () => config({ [configuredRoot]: MERGE_TD }),
			createTodoistClient: () => client,
		});
		await h.handlers.get(SESSION_START)?.(
			{ type: SESSION_START, reason: STARTUP },
			h.ctx,
		);
		await writePiTaskStore(sessionTaskPath(worktree, SESSION_CURRENT), {
			nextId: 2,
			tasks: [
				{
					id: VALUE_1,
					subject: WORKTREE_TASK,
					description: EMPTY_STRING,
					status: PENDING_VALUE,
					metadata: {},
					blocks: [],
					blockedBy: [],
					createdAt: 1,
					updatedAt: 1,
				},
			],
		});
		await h.handlers.get(AGENT_SETTLED)?.({ type: AGENT_SETTLED }, h.ctx);
		await vi.waitFor(() => {
			expect(created).toEqual([PARENT_WORKTREE_TASK]);
		});
	});
});

describe("automatic Todoist task linking", () => {
	it(LINKS_A_CLAIMED_TASK_FROM_SESSION_HISTORY, async () => {
		const root = await mkdtemp(join(tmpdir(), PI_TODO_GATE_AUTO_LINK));
		const h = harness(root, [
			{
				type: MESSAGE,
				message: {
					role: ASSISTANT,
					content: [
						{
							type: TEXT_CONTENT_TYPE,
							text: CLAIMED_TODOIST_TASK_HTTPS_APP_TODOIST_COM,
						},
					],
				},
			},
		]);
		const client: any = {
			resolveProject: async () => ({
				id: PROJECT_1,
				name: MERGE_TD,
			}),
			claimTask: async () => ({
				id: VALUE_42,
				content: IMPLEMENT_FEATURE,
				webUrl: HTTPS_APP_TODOIST_COM_APP_TASK_42,
				projectId: PROJECT_1,
			}),
			listDescendants: async () => [],
		};
		extension(h.pi, {
			loadConfig: async () => config({ [root]: MERGE_TD }),
			createTodoistClient: () => client,
		});
		await h.handlers.get(SESSION_START)?.(
			{ type: SESSION_START, reason: STARTUP },
			h.ctx,
		);

		expect(h.appended.at(-1)).toEqual({
			type: PI_TODO_GATE_STATE_2,
			data: {
				taskRef: VALUE_42,
				taskName: IMPLEMENT_FEATURE,
				taskUrl: HTTPS_APP_TODOIST_COM_APP_TASK_42,
			},
		});
		expect(h.statusCalls.at(-1)).toEqual({
			key: PI_TODO_GATE_TASK,
			text: expect.stringContaining(IMPLEMENT_FEATU),
		});
	});

	it(LINKS_A_TASK_URL_FROM_HISTORY_WHEN, async () => {
		const root = await mkdtemp(join(tmpdir(), PI_TODO_GATE_PROMPT_LINK));
		const h = harness(root, [
			{
				type: MESSAGE,
				message: {
					role: ASSISTANT,
					content: TODOIST_TASK_URL_HTTPS_APP_TODOIST_COM,
				},
			},
		]);
		const client: any = {
			resolveProject: async () => ({
				id: PROJECT_1,
				name: MERGE_TD,
			}),
			claimTask: async () => ({
				id: VALUE_42,
				content: IMPLEMENT_FEATURE,
				webUrl: HTTPS_APP_TODOIST_COM_APP_TASK_42,
				projectId: PROJECT_1,
			}),
			listDescendants: async () => [],
		};
		extension(h.pi, {
			loadConfig: async () => config({ [root]: MERGE_TD }),
			createTodoistClient: () => client,
		});
		await h.handlers.get(SESSION_START)?.(
			{ type: SESSION_START, reason: STARTUP },
			h.ctx,
		);
		expect(h.appended).toHaveLength(0);

		await h.handlers.get(BEFORE_AGENT_START)?.(
			{
				type: BEFORE_AGENT_START,
				prompt: CLAIMED_TODOIST_TASK_FOR_THIS_SESSION,
			},
			h.ctx,
		);

		expect(h.appended.at(-1)).toEqual({
			type: PI_TODO_GATE_STATE_2,
			data: {
				taskRef: VALUE_42,
				taskName: IMPLEMENT_FEATURE,
				taskUrl: HTTPS_APP_TODOIST_COM_APP_TASK_42,
			},
		});
	});

	it(LINKS_A_SUCCESSFULLY_MOVED_TASK_AS_SOON, async () => {
		const root = await mkdtemp(join(tmpdir(), PI_TODO_GATE_TOOL_LINK));
		const h = harness(root);
		const client: any = {
			resolveProject: async () => ({
				id: PROJECT_1,
				name: MERGE_TD,
			}),
			claimTask: async () => ({
				id: VALUE_42,
				content: IMPLEMENT_FEATURE,
				webUrl: HTTPS_APP_TODOIST_COM_APP_TASK_42,
				projectId: PROJECT_1,
			}),
			listDescendants: async () => [],
		};
		extension(h.pi, {
			loadConfig: async () => config({ [root]: MERGE_TD }),
			createTodoistClient: () => client,
		});
		await h.handlers.get(SESSION_START)?.(
			{ type: SESSION_START, reason: STARTUP },
			h.ctx,
		);

		await h.handlers.get(TOOL_RESULT)?.(
			{
				type: TOOL_RESULT,
				toolName: BASH,
				input: { command: TD_TASK_VIEW_42 },
				content: [
					{ type: TEXT_CONTENT_TYPE, text: TODOIST_TASK_IS_CLAIMED_42 },
				],
				isError: false,
			},
			h.ctx,
		);

		expect(h.appended.at(-1)).toEqual({
			type: PI_TODO_GATE_STATE_2,
			data: {
				taskRef: VALUE_42,
				taskName: IMPLEMENT_FEATURE,
				taskUrl: HTTPS_APP_TODOIST_COM_APP_TASK_42,
			},
		});
		expect(h.statusCalls.at(-1)?.text).toContain(IMPLEMENT_FEATU);
	});

	it(DOES_NOT_TREAT_THE_MISSING_TASK_WARNING, async () => {
		const root = await mkdtemp(join(tmpdir(), PI_TODO_GATE_NEGATIVE_LINK));
		const h = harness(root, [
			{
				type: MESSAGE,
				message: {
					role: ASSISTANT,
					content: TODOIST_TASK_URL_HTTPS_APP_TODOIST_COM,
				},
			},
		]);
		await start(h, { [root]: MERGE_TD });
		await h.handlers.get(BEFORE_AGENT_START)?.(
			{
				type: BEFORE_AGENT_START,
				prompt: YOU_HAVE_NO_CLAIMED_A_TODOIST_TASK,
			},
			h.ctx,
		);
		expect(h.appended).toHaveLength(0);
	});
});

describe("hidden lifecycle context", () => {
	it(WARNS_ON_EVERY_PROMPT_ONLY_WHEN_NO, async () => {
		const h = harness(CONFIGURED_PROJECT);
		await start(h, { "/configured": MERGE_TD });
		const result = await h.handlers.get(BEFORE_AGENT_START)?.(
			{ type: BEFORE_AGENT_START, prompt: WORK },
			h.ctx,
		);
		expect(result.message.content).toContain(
			YOU_HAVE_NO_CLAIMED_A_TODOIST_TASK_2,
		);

		const withTask = harness(CONFIGURED_PROJECT, [
			{
				type: CUSTOM,
				customType: PI_TODO_GATE_STATE_2,
				data: { taskRef: VALUE_42, taskUrl: HTTPS_APP_TODOIST_COM_APP_TASK_42 },
			},
		]);
		await start(withTask, { "/configured": MERGE_TD });
		const second = await withTask.handlers.get(BEFORE_AGENT_START)?.(
			{ type: BEFORE_AGENT_START, prompt: WORK },
			withTask.ctx,
		);
		expect(second).toBeUndefined();
	});

	it(DISCOVERS_THE_FIRST_PR_URL_AND_IGNORES, async () => {
		const h = harness(CONFIGURED_PROJECT, [
			{
				type: MESSAGE,
				message: {
					role: USER,
					content: [
						{ type: TEXT_CONTENT_TYPE, text: HTTPS_GITHUB_COM_O_R_PULL_1 },
					],
				},
			},
		]);
		await start(h, { "/configured": MERGE_TD });
		await h.handlers.get(MESSAGE_END)?.(
			{
				type: MESSAGE_END,
				message: {
					role: ASSISTANT,
					content: [
						{ type: TEXT_CONTENT_TYPE, text: HTTPS_GITHUB_COM_O_R_PULL_2 },
					],
				},
			},
			h.ctx,
		);
		expect(h.appended).toEqual([
			{
				type: PI_TODO_GATE_STATE_2,
				data: { prUrl: HTTPS_GITHUB_COM_O_R_PULL_1 },
			},
		]);
		await h.handlers.get(MESSAGE_END)?.(
			{
				type: MESSAGE_END,
				message: {
					role: ASSISTANT,
					content: HTTPS_GITHUB_COM_O_R_PULL_3,
				},
			},
			h.ctx,
		);
		expect(h.appended).toHaveLength(1);
	});

	it(NEVER_SENDS_SYNCHRONIZATION_MESSAGES_TO_THE_AGENT, async () => {
		const h = harness(CONFIGURED_PROJECT);
		let sent = 0;
		h.pi.sendMessage = () => {
			sent += 1;
		};
		h.pi.sendUserMessage = () => {
			sent += 1;
		};
		await start(h, { "/configured": MERGE_TD });
		expect(sent).toBe(0);
	});
});

describe("pi_todo_gate_state", () => {
	it(VALIDATES_AND_PERSISTS_AN_EXPLICIT_PR_OVERRIDE, async () => {
		const h = harness(CONFIGURED_PROJECT, [
			{
				type: CUSTOM,
				customType: PI_TODO_GATE_STATE_2,
				data: {
					prUrl: HTTPS_GITHUB_COM_O_R_PULL_1,
					mergeCompletedAt: OLD,
					todoistCompletionAttemptedAt: OLD,
				},
			},
		]);
		await start(h, { "/configured": MERGE_TD });
		const result = await h.tools[0].execute(
			CALL,
			{ action: SET_PR, url: HTTPS_GITHUB_COM_O_R_PULL_42 },
			undefined,
			undefined,
			h.ctx,
		);
		expect(h.appended.at(-1)).toEqual({
			type: PI_TODO_GATE_STATE_2,
			data: { prUrl: HTTPS_GITHUB_COM_O_R_PULL_42_2 },
		});
		expect(result.content[0].text).toContain(VALUE_42);
		expect(h.statusCalls.slice(-2)).toEqual([
			{
				key: PI_TODO_GATE_PR,
				text: expect.stringContaining(PR_LINK),
			},
			{ key: PI_TODO_GATE_TASK, text: TODOIST_TASK_NONE },
		]);
	});

	it(CLEANS_UP_CONFIGURED_UI_WHEN_A_SESSION, async () => {
		const h = harness(CONFIGURED_PROJECT);
		await start(h, { "/configured": MERGE_TD });
		await h.handlers.get(SESSION_START)?.(
			{ type: SESSION_START, reason: RESUME },
			{ ...h.ctx, cwd: UNCONFIGURED },
		);
		expect(h.footerCalls.at(-1)).toBeUndefined();
	});

	it(DOES_NOT_INHERIT_STATE_FROM_ANOTHER_CODING, async () => {
		const h = harness(CONFIGURED);
		extension(h.pi, {
			loadConfig: async () =>
				config({
					"/configured": PARENT,
					"/configured/project": CHILD,
				}),
			openSession: () => ({
				getBranch: () => [
					{
						type: CUSTOM,
						customType: PI_TODO_GATE_STATE_2,
						data: { prUrl: HTTPS_GITHUB_COM_O_R_PULL_1 },
					},
				],
				getSessionId: () => PREVIOUS,
				getCwd: () => CONFIGURED_PROJECT,
			}),
		});
		await h.handlers.get(SESSION_START)?.(
			{
				type: SESSION_START,
				reason: RESUME,
				previousSessionFile: SESSIONS_PREVIOUS_JSONL,
			},
			h.ctx,
		);
		expect(h.appended).toHaveLength(0);
	});

	it(CLEARING_A_TASK_CLEARS_ITS_COMPLETION_METADATA, async () => {
		const root = await mkdtemp(join(tmpdir(), PI_TODO_GATE_EXTENSION));
		const h = harness(root, [
			{
				type: CUSTOM,
				customType: PI_TODO_GATE_STATE_2,
				data: {
					taskRef: TASK_1,
					mergeCompletedAt: OLD,
					todoistCompletionAttemptedAt: OLD,
				},
			},
		]);
		extension(h.pi, {
			loadConfig: async () => config({ [root]: MERGE_TD }),
			createTodoistClient: () => ({ listDescendants: async () => [] }) as any,
		});
		await h.handlers.get(SESSION_START)?.(
			{ type: SESSION_START, reason: STARTUP },
			h.ctx,
		);
		await h.tools[0].execute(
			CALL,
			{ action: CLEAR_TASK },
			undefined,
			undefined,
			h.ctx,
		);
		expect(h.appended.at(-1)).toEqual({
			type: PI_TODO_GATE_STATE_2,
			data: {},
		});
	});

	it(DOES_NOT_RUN_A_PENDING_OLD_PARENT, async () => {
		vi.useFakeTimers();
		try {
			const root = await mkdtemp(join(tmpdir(), PI_TODO_GATE_EXTENSION));
			const h = harness(root, [
				{
					type: CUSTOM,
					customType: PI_TODO_GATE_STATE_2,
					data: { taskRef: OLD },
				},
			]);
			const calls: string[] = [];
			const client: any = {
				resolveProject: async () => ({
					id: PROJECT_1,
					name: MERGE_TD,
				}),
				claimTask: async (ref: string) => ({
					id: ref,
					webUrl: `https://app.todoist.com/app/task/${ref}`,
					projectId: PROJECT_1,
				}),
				listDescendants: async (ref: string) => {
					calls.push(`list:${ref}`);
					return [];
				},
			};
			extension(h.pi, {
				loadConfig: async () => config({ [root]: MERGE_TD }),
				createTodoistClient: () => client,
			});
			await h.handlers.get(SESSION_START)?.(
				{ type: SESSION_START, reason: STARTUP },
				h.ctx,
			);
			calls.length = 0;
			await h.handlers.get(AGENT_SETTLED)?.({ type: AGENT_SETTLED }, h.ctx);
			await h.tools[0].execute(
				CALL,
				{ action: SET_TASK, task: VALUE_NEW },
				undefined,
				undefined,
				h.ctx,
			);
			await vi.advanceTimersByTimeAsync(30);
			expect(calls).toEqual([LIST_NEW]);
		} finally {
			vi.useRealTimers();
		}
	});

	it(RECORDS_FAILED_TODOIST_COMPLETION_ATTEMPTS, async () => {
		const root = await mkdtemp(join(tmpdir(), PI_TODO_GATE_EXTENSION));
		const h = harness(root, [
			{
				type: CUSTOM,
				customType: PI_TODO_GATE_STATE_2,
				data: {
					prUrl: HTTPS_GITHUB_COM_O_R_PULL_42_2,
					taskRef: TASK_1,
				},
			},
		]);
		const client: any = {
			listDescendants: async () => [],
			completeTask: async () => {
				throw new Error(TODOIST_UNAVAILABLE);
			},
		};
		const exec = async () => ({
			stdout: JSON.stringify({ headRefName: FEATURE_AUTH }),
			stderr: EMPTY_STRING,
			code: 0,
		});
		extension(h.pi, {
			loadConfig: async () => config({ [root]: MERGE_TD }),
			createTodoistClient: () => client,
			exec,
		});
		await h.handlers.get(SESSION_START)?.(
			{ type: SESSION_START, reason: STARTUP },
			h.ctx,
		);
		await h.handlers.get(TOOL_RESULT)?.(
			{
				type: TOOL_RESULT,
				toolName: BASH,
				input: { command: GIT_MERGE_FEATURE_AUTH },
				isError: false,
			},
			h.ctx,
		);
		expect(
			(h.appended.at(-1) as { data: { todoistCompletionAttemptedAt?: string } })
				.data.todoistCompletionAttemptedAt,
		).toEqual(expect.any(String));
	});

	it(DOES_NOT_OUTBOUND_SYNC_AFTER_AN_INBOUND, async () => {
		vi.useFakeTimers();
		try {
			const root = await mkdtemp(join(tmpdir(), PI_TODO_GATE_EXTENSION));
			const h = harness(root, [
				{
					type: CUSTOM,
					customType: PI_TODO_GATE_STATE_2,
					data: { taskRef: OLD },
				},
			]);
			let lists = 0;
			const client: any = {
				listDescendants: async () => {
					lists += 1;
					throw new Error(RESTORE_FAILED);
				},
			};
			extension(h.pi, {
				loadConfig: async () => config({ [root]: MERGE_TD }),
				createTodoistClient: () => client,
			});
			await h.handlers.get(SESSION_START)?.(
				{ type: SESSION_START, reason: STARTUP },
				h.ctx,
			);
			await h.handlers.get(AGENT_SETTLED)?.({ type: AGENT_SETTLED }, h.ctx);
			await vi.advanceTimersByTimeAsync(30);
			expect(lists).toBe(1);
		} finally {
			vi.useRealTimers();
		}
	});

	it(SWITCHES_TASKS_ONLY_AFTER_LOADING_THE_NEW, async () => {
		const root = await mkdtemp(join(tmpdir(), PI_TODO_GATE_EXTENSION));
		const h = harness(root, [
			{
				type: CUSTOM,
				customType: PI_TODO_GATE_STATE_2,
				data: {
					taskRef: OLD,
					taskUrl: HTTPS_APP_TODOIST_COM_APP_TASK_OLD,
				},
			},
		]);
		const calls: string[] = [];
		const client: any = {
			resolveProject: async () => ({
				id: PROJECT_1,
				name: MERGE_TD,
			}),
			claimTask: async (ref: string) => ({
				id: ref,
				content: ADD_DIALOG_CONTROLS,
				webUrl: `https://app.todoist.com/app/task/${ref}`,
				projectId: PROJECT_1,
			}),
			listDescendants: async (ref: string) => {
				calls.push(`list:${ref}`);
				return [
					{
						id: NEW_CHILD,
						content: NEW_CHILD_2,
						description: EMPTY_STRING,
						projectId: PROJECT_1,
					},
				];
			},
		};
		extension(h.pi, {
			loadConfig: async () => config({ [root]: MERGE_TD }),
			createTodoistClient: () => client,
		});
		await h.handlers.get(SESSION_START)?.(
			{ type: SESSION_START, reason: STARTUP },
			h.ctx,
		);
		calls.length = 0;
		await h.tools[0].execute(
			CALL,
			{ action: SET_TASK, task: NEW_PARENT },
			undefined,
			undefined,
			h.ctx,
		);
		expect(calls).toEqual([LIST_NEW_PARENT]);
		expect(h.appended.at(-1)).toEqual({
			type: PI_TODO_GATE_STATE_2,
			data: {
				taskRef: NEW_PARENT,
				taskName: ADD_DIALOG_CONTROLS,
				taskUrl: HTTPS_APP_TODOIST_COM_APP_TASK_NEW,
			},
		});
		await expect(
			readPiTaskStore(sessionTaskPath(root, SESSION_CURRENT)),
		).resolves.toMatchObject({
			tasks: [{ subject: NEW_CHILD_3 }],
		});
	});

	it(REJECTS_INVALID_PR_URLS_WITHOUT_PERSISTING_THEM, async () => {
		const h = harness(CONFIGURED_PROJECT);
		await start(h, { "/configured": MERGE_TD });
		await expect(
			h.tools[0].execute(
				CALL,
				{ action: SET_PR, url: HTTPS_EXAMPLE_COM_PR_42 },
				undefined,
				undefined,
				h.ctx,
			),
		).rejects.toThrow();
		expect(h.appended).toHaveLength(0);
	});
});
