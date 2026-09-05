const PRINT = "print";
const SESSION_CURRENT = "session-current";
const SESSIONS_CURRENT_JSONL = "/sessions/current.jsonl";
const SESSIONS = "/sessions";
const EMPTY_STRING = "";
const SESSION_START = "session_start";
const STARTUP = "startup";
const DOES_NOT_REGISTER_TOOLS_OR_PERFORM_EXTERNAL =
	"does not register tools or perform external work for an unmatched project";
const DOES_NOT_ACTIVATE_FOR_DISPATCHED_SUBAGENT =
	"does not activate for dispatched subagent";
const SKIPS_ANY_DEFINED_SUBAGENT_MARKER = "skips any defined subagent marker";
const UNCONFIGURED_PROJECT = "/unconfigured/project";
const MERGE_TD = "merge-td";
const REGISTERS_THE_STATE_TOOL_ONLY_FOR_A =
	"registers the state tool only for a matched project";
const CONFIGURED_PROJECT = "/configured/project";
const PI_TODO_GATE_STATE_TOOL = "pi_todo_gate_state";
const KEEPS_NATIVE_FOOTER_AND_PUBLISHES_PR_TASK =
	"keeps native footer and publishes PR/task statuses";
const TUI = "tui";
const PI_TODO_GATE_PR = "pi-todo-gate-pr";
const PR_LINK_NONE = "| PR Link: none |";
const PI_TODO_GATE_TASK = "pi-todo-gate-task";
const TODOIST_TASK_NONE = "Todoist Task: none";
const CUSTOM = "custom";
const PI_TODO_GATE_STATE_ENTRY = "pi-todo-gate-state";
const PARENT = "parent";
const MESSAGE = "message";
const ASSISTANT = "assistant";
const TEXT_CONTENT_TYPE = "text";
const PROJECT_1 = "project-1";
const VALUE_42 = "42";
const IMPLEMENT_FEATURE = "Implement feature";
const HTTPS_APP_TODOIST_COM_APP_TASK_42 = "https://app.todoist.com/app/task/42";
const BEFORE_AGENT_START = "before_agent_start";
const TOOL_RESULT = "tool_result";
const BASH = "bash";
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
const INHERITS_STATE_WHEN_LATEST_STATE_ENTRY_IS_MALFORMED =
	"inherits state when latest state entry is malformed";
const CONFIGURED = "/configured";
const CHILD = "child";
const PREVIOUS = "previous";
const SESSIONS_PREVIOUS_JSONL = "/sessions/previous.jsonl";
const CLEARING_A_TASK_CLEARS_ITS_COMPLETION_METADATA =
	"clearing a task clears its completion metadata";
const PI_TODO_GATE_EXTENSION = "pi-todo-gate-extension-";
const TASK_1 = "task-1";
const TASK_A = "task-a";
const TASK_B = "task-b";
const INFERRED_TASK = "inferred-task";
const CLEAR_TASK = "clear_task";
const SET_TASK = "set_task";
const DOES_NOT_COMPLETE_BEFORE_EXIT_ACTION =
	"does not complete a merged task before the exit action";
const DOES_NOT_COMPLETE_STALE_MERGE_TASK =
	"does not complete task after stale merge result";
const DOES_NOT_OVERWRITE_NEWER_STATE_AFTER_COMPLETION =
	"does not overwrite newer state after completion";
const DOES_NOT_COMPLETE_ABA_RECLAIM = "does not complete ABA-reclaimed task";
const SERIALIZES_CONCURRENT_TASK_CLAIMS = "serializes concurrent task claims";
const CLEARS_INFERRED_TASK_AFTER_PENDING_CLAIM =
	"clears inferred task after pending claim";
const CLEARS_SET_TASK_DURING_PENDING_CLAIM =
	"clears set_task during pending claim";
const IGNORES_STALE_CLAIM_ERROR = "ignores stale claim error";
const TASK_NAME = "task name";
const TASK_URL = "https://app.todoist.com/app/task/task-1";
const TODOIST_UNAVAILABLE = "Todoist unavailable";
const FEATURE_AUTH = "feature/auth";
const GIT_MERGE_FEATURE_AUTH = "git merge feature/auth";
const REJECTS_INVALID_PR_URLS_WITHOUT_PERSISTING_THEM =
	"rejects invalid PR URLs without persisting them";
const REMOVES_TODOIST_TASK_ACTIONS =
	"removes Todoist task actions from the state tool";
const CLEAR_ALL_PRESERVES_TASK_STATE =
	"clear_all preserves internal task state while clearing PR state";
const HTTPS_EXAMPLE_COM_PR_42 = "https://example.com/pr/42";

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import extension from "../../extensions/pi-todo-gate.ts";
import type { TodoistClient } from "../../src/todoist/client.ts";

type TestHandler = (event: unknown, ctx: unknown) => Promise<unknown> | unknown;
type TestTool = {
	name: string;
	execute: (...args: unknown[]) => Promise<unknown> | unknown;
};
type BeforeAgentResult = { message: { content: string } };
type StateToolResult = { content: Array<{ text: string }> };

function harness(
	cwd: string,
	branch: unknown[] = [],
	confirmResponse = true,
	selectResponse?: string,
) {
	const handlers = new Map<string, TestHandler>();
	const tools: TestTool[] = [];
	const appended: unknown[] = [];
	const notifications: string[] = [];
	const confirmations: Array<{ title: string; message: string }> = [];
	const selections: Array<{ title: string; options: string[] }> = [];
	const footerCalls: unknown[] = [];
	const statusCalls: Array<{ key: string; text: string | undefined }> = [];
	const pi = {
		on: (event: string, handler: unknown) => {
			if (typeof handler === "function")
				if (!handlers.has(event)) handlers.set(event, handler as TestHandler);
		},
		registerTool: (tool: unknown) => tools.push(tool as TestTool),
		appendEntry: (type: string, data: unknown) => appended.push({ type, data }),
	} as unknown as ExtensionAPI;
	const ctx = {
		cwd,
		mode: PRINT,
		hasUI: false,
		ui: {
			theme: { fg: (_color: string, text: string) => text },
			notify: (message: string) => notifications.push(message),
			confirm: async (title: string, message: string) => {
				confirmations.push({ title, message });
				return confirmResponse;
			},
			select: async (title: string, options: string[]) => {
				selections.push({ title, options });
				return selectResponse ?? options[0];
			},
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
	} as unknown as ExtensionContext;
	return {
		pi,
		ctx,
		handlers,
		tools,
		appended,
		notifications,
		footerCalls,
		statusCalls,
		confirmations,
		selections,
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
	it(DOES_NOT_ACTIVATE_FOR_DISPATCHED_SUBAGENT, () => {
		const h = harness(CONFIGURED_PROJECT);
		const previous = process.env.PI_SUBAGENT_CHILD;
		const loadConfig = vi.fn(async () =>
			config({ [CONFIGURED_PROJECT]: MERGE_TD }),
		);
		process.env.PI_SUBAGENT_CHILD = "1";
		try {
			extension(h.pi, { loadConfig });
		} finally {
			if (previous === undefined) delete process.env.PI_SUBAGENT_CHILD;
			else process.env.PI_SUBAGENT_CHILD = previous;
		}

		expect(loadConfig).not.toHaveBeenCalled();
		expect(h.handlers).toHaveLength(0);
		expect(h.tools).toHaveLength(0);
	});

	it(SKIPS_ANY_DEFINED_SUBAGENT_MARKER, () => {
		const h = harness(CONFIGURED_PROJECT);
		const previous = process.env.PI_SUBAGENT_CHILD;
		process.env.PI_SUBAGENT_CHILD = "0";
		try {
			extension(h.pi);
		} finally {
			if (previous === undefined) delete process.env.PI_SUBAGENT_CHILD;
			else process.env.PI_SUBAGENT_CHILD = previous;
		}

		expect(h.handlers).toHaveLength(0);
		expect(h.tools).toHaveLength(0);
	});

	it(DOES_NOT_REGISTER_TOOLS_OR_PERFORM_EXTERNAL, async () => {
		const h = harness(UNCONFIGURED_PROJECT);
		await start(h, { "/configured": MERGE_TD });
		expect(h.tools).toHaveLength(0);
		expect(h.appended).toHaveLength(0);
	});

	it(REGISTERS_THE_STATE_TOOL_ONLY_FOR_A, async () => {
		const h = harness(CONFIGURED_PROJECT);
		await start(h, { "/configured": MERGE_TD });
		expect(h.tools.map((tool) => tool.name)).toEqual([PI_TODO_GATE_STATE_TOOL]);
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

describe("confirmation-gated Todoist task claiming", () => {
	it("shows and applies an existing-task proposal", async () => {
		const root = await mkdtemp(join(tmpdir(), "claim-confirm"));
		const h = harness(root);
		h.ctx.hasUI = true;
		const claimTask = vi.fn(async () => ({
			id: VALUE_42,
			content: IMPLEMENT_FEATURE,
			description: "Details",
			webUrl: HTTPS_APP_TODOIST_COM_APP_TASK_42,
			projectId: PROJECT_1,
		}));
		const client = {
			resolveProject: async () => ({ id: PROJECT_1, name: MERGE_TD }),
			claimTask,
		};
		extension(h.pi, {
			loadConfig: async () => config({ [root]: MERGE_TD }),
			createTodoistClient: () => client as unknown as TodoistClient,
			taskClaimWorker: async () => ({
				action: "claim",
				taskData: {
					title: IMPLEMENT_FEATURE,
					description: "Details",
					id: VALUE_42,
				},
				error: null,
			}),
		});
		await start(h, { [root]: MERGE_TD });
		await h.handlers.get(BEFORE_AGENT_START)?.(
			{ type: BEFORE_AGENT_START, prompt: "work" },
			h.ctx,
		);
		await new Promise((resolve) => setTimeout(resolve, 25));
		expect(h.confirmations[0]?.message).toContain("claim existing task");
		expect(h.confirmations[0]?.message).toContain(IMPLEMENT_FEATURE);
		expect(h.confirmations[0]?.message).toContain("Details");
		expect(claimTask).toHaveBeenCalledWith(
			VALUE_42,
			{ id: PROJECT_1 },
			expect.any(Function),
		);
		expect(h.appended.at(-1)).toMatchObject({
			data: { taskRef: VALUE_42, taskName: IMPLEMENT_FEATURE },
		});
	});

	it("does not mutate Todoist when a proposal is declined", async () => {
		const root = await mkdtemp(join(tmpdir(), "decline-confirm"));
		const h = harness(root, [], false);
		h.ctx.hasUI = true;
		const claimTask = vi.fn();
		const client = {
			resolveProject: async () => ({ id: PROJECT_1, name: MERGE_TD }),
			claimTask,
		};
		extension(h.pi, {
			loadConfig: async () => config({ [root]: MERGE_TD }),
			createTodoistClient: () => client as unknown as TodoistClient,
			taskClaimWorker: async () => ({
				action: "claim" as const,
				taskData: {
					title: IMPLEMENT_FEATURE,
					description: "Details",
					id: VALUE_42,
				},
				error: null,
			}),
		});
		await start(h, { [root]: MERGE_TD });
		await h.handlers.get(BEFORE_AGENT_START)?.(
			{ type: BEFORE_AGENT_START, prompt: "work" },
			h.ctx,
		);
		await new Promise((resolve) => setTimeout(resolve, 25));
		expect(h.confirmations[0]?.message).toContain(IMPLEMENT_FEATURE);
		expect(claimTask).not.toHaveBeenCalled();
		expect(h.appended.at(-1)).not.toMatchObject({
			data: { taskRef: expect.any(String) },
		});
	});

	it("shows and applies a new-task proposal with its description", async () => {
		const root = await mkdtemp(join(tmpdir(), "create-confirm"));
		const h = harness(root);
		h.ctx.hasUI = true;
		const createTask = vi.fn(async () => ({
			id: "43",
			content: "New task",
			description: "Proposed details",
			webUrl: "https://app.todoist.com/app/task/43",
			projectId: PROJECT_1,
		}));
		const client = {
			resolveProject: async () => ({ id: PROJECT_1, name: MERGE_TD }),
			createTask,
		};
		extension(h.pi, {
			loadConfig: async () => config({ [root]: MERGE_TD }),
			createTodoistClient: () => client as unknown as TodoistClient,
			taskClaimWorker: async () => ({
				action: "create",
				taskData: {
					title: "New task",
					description: "Proposed details",
					id: null,
				},
				error: null,
			}),
		});
		await start(h, { [root]: MERGE_TD });
		await h.handlers.get(BEFORE_AGENT_START)?.(
			{ type: BEFORE_AGENT_START, prompt: "work" },
			h.ctx,
		);
		await new Promise((resolve) => setTimeout(resolve, 25));

		expect(h.confirmations[0]?.message).toContain("new task");
		expect(createTask).toHaveBeenCalledWith(
			"New task",
			"Proposed details",
			{ id: PROJECT_1 },
			expect.any(Function),
		);
		expect(h.appended.at(-1)).toMatchObject({
			data: { taskRef: "43", taskName: "New task" },
		});
	});

	it("offers retry after an error proposal", async () => {
		const root = await mkdtemp(join(tmpdir(), "retry-confirm"));
		const h = harness(root);
		h.ctx.hasUI = true;
		let attempts = 0;
		const worker = vi.fn(async () => {
			attempts += 1;
			return attempts === 1
				? { action: "error" as const, taskData: null, error: "Unavailable" }
				: {
						action: "create" as const,
						taskData: { title: "Retry task", description: "Details", id: null },
						error: null,
					};
		});
		const client = {
			resolveProject: async () => ({ id: PROJECT_1, name: MERGE_TD }),
			createTask: async () => ({
				id: "44",
				content: "Retry task",
				description: "Details",
				webUrl: "https://app.todoist.com/app/task/44",
				projectId: PROJECT_1,
			}),
		};
		extension(h.pi, {
			loadConfig: async () => config({ [root]: MERGE_TD }),
			createTodoistClient: () => client as unknown as TodoistClient,
			taskClaimWorker: worker,
		});
		await start(h, { [root]: MERGE_TD });
		await h.handlers.get(BEFORE_AGENT_START)?.(
			{ type: BEFORE_AGENT_START, prompt: "work" },
			h.ctx,
		);
		await new Promise((resolve) => setTimeout(resolve, 50));

		expect(h.selections[0]?.options).toEqual([
			"Retry task claiming",
			"Leave task unassigned",
		]);
		expect(worker).toHaveBeenCalledTimes(2);
		expect(h.confirmations[0]?.message).toContain("Retry task");
	});

	it("does not infer or mutate a task from the missing-task warning", async () => {
		const root = await mkdtemp(join(tmpdir(), "no-inference"));
		const h = harness(root);
		h.ctx.hasUI = false;
		const worker = vi.fn(async () => ({
			action: "error" as const,
			taskData: null,
			error: "not used",
		}));
		extension(h.pi, {
			loadConfig: async () => config({ [root]: MERGE_TD }),
			taskClaimWorker: worker,
		});
		await start(h, { [root]: MERGE_TD });
		await h.handlers.get(BEFORE_AGENT_START)?.(
			{
				type: BEFORE_AGENT_START,
				prompt: "you have no claimed a todoist task yet!",
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
		const result = (await h.handlers.get(BEFORE_AGENT_START)?.(
			{ type: BEFORE_AGENT_START, prompt: WORK },
			h.ctx,
		)) as BeforeAgentResult;
		expect(result.message.content).toContain(
			YOU_HAVE_NO_CLAIMED_A_TODOIST_TASK_2,
		);

		const withTask = harness(CONFIGURED_PROJECT, [
			{
				type: CUSTOM,
				customType: PI_TODO_GATE_STATE_ENTRY,
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
				type: PI_TODO_GATE_STATE_ENTRY,
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
	it(REMOVES_TODOIST_TASK_ACTIONS, async () => {
		const h = harness(CONFIGURED_PROJECT);
		await start(h, { "/configured": MERGE_TD });
		const registered = JSON.stringify(h.tools[0]);
		expect(registered).not.toContain("set_task");
		expect(registered).not.toContain("clear_task");
		expect(registered).toContain("clear_all");
	});

	it(CLEAR_ALL_PRESERVES_TASK_STATE, async () => {
		const h = harness(CONFIGURED_PROJECT, [
			{
				type: CUSTOM,
				customType: PI_TODO_GATE_STATE_ENTRY,
				data: {
					prUrl: HTTPS_GITHUB_COM_O_R_PULL_1,
					taskRef: TASK_1,
				},
			},
		]);
		await start(h, { "/configured": MERGE_TD });
		await h.tools[0].execute(
			CALL,
			{ action: "clear_all" },
			undefined,
			undefined,
			h.ctx,
		);
		expect(h.appended.at(-1)).toMatchObject({
			data: { taskRef: TASK_1, prDiscoveryDisabled: true },
		});
		expect(h.appended.at(-1)).not.toMatchObject({
			data: { prUrl: expect.any(String) },
		});
	});

	it(VALIDATES_AND_PERSISTS_AN_EXPLICIT_PR_OVERRIDE, async () => {
		const h = harness(CONFIGURED_PROJECT, [
			{
				type: CUSTOM,
				customType: PI_TODO_GATE_STATE_ENTRY,
				data: {
					prUrl: HTTPS_GITHUB_COM_O_R_PULL_1,
					mergeCompletedAt: OLD,
					todoistCompletionAttemptedAt: OLD,
				},
			},
		]);
		await start(h, { "/configured": MERGE_TD });
		const result = (await h.tools[0].execute(
			CALL,
			{ action: SET_PR, url: HTTPS_GITHUB_COM_O_R_PULL_42 },
			undefined,
			undefined,
			h.ctx,
		)) as StateToolResult;
		expect(h.appended.at(-1)).toEqual({
			type: PI_TODO_GATE_STATE_ENTRY,
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
						customType: PI_TODO_GATE_STATE_ENTRY,
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

	it(INHERITS_STATE_WHEN_LATEST_STATE_ENTRY_IS_MALFORMED, async () => {
		const root = await mkdtemp(join(tmpdir(), PI_TODO_GATE_EXTENSION));
		const h = harness(root, [
			{
				type: CUSTOM,
				customType: PI_TODO_GATE_STATE_ENTRY,
				data: { taskRef: 42 },
			},
		]);
		extension(h.pi, {
			loadConfig: async () => config({ [root]: MERGE_TD }),
			openSession: () => ({
				getBranch: () => [
					{
						type: CUSTOM,
						customType: PI_TODO_GATE_STATE_ENTRY,
						data: { taskRef: TASK_1 },
					},
				],
				getSessionId: () => PREVIOUS,
				getCwd: () => root,
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
		expect(h.appended.at(-1)).toMatchObject({
			type: PI_TODO_GATE_STATE_ENTRY,
			data: { taskRef: TASK_1, inheritedFrom: PREVIOUS },
		});
	});

	it.skip(CLEARING_A_TASK_CLEARS_ITS_COMPLETION_METADATA, async () => {
		const root = await mkdtemp(join(tmpdir(), PI_TODO_GATE_EXTENSION));
		const h = harness(root, [
			{
				type: CUSTOM,
				customType: PI_TODO_GATE_STATE_ENTRY,
				data: {
					taskRef: TASK_1,
					mergeCompletedAt: OLD,
					todoistCompletionAttemptedAt: OLD,
				},
			},
		]);
		extension(h.pi, {
			loadConfig: async () => config({ [root]: MERGE_TD }),
			createTodoistClient: () => ({}) as unknown as TodoistClient,
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
			type: PI_TODO_GATE_STATE_ENTRY,
			data: {},
		});
	});

	it.skip(DOES_NOT_COMPLETE_STALE_MERGE_TASK, async () => {
		const root = await mkdtemp(join(tmpdir(), PI_TODO_GATE_EXTENSION));
		const h = harness(root, [
			{
				type: CUSTOM,
				customType: PI_TODO_GATE_STATE_ENTRY,
				data: {
					prUrl: HTTPS_GITHUB_COM_O_R_PULL_42_2,
					taskRef: TASK_1,
				},
			},
		]);
		let resolveExec:
			| ((result: { stdout: string; stderr: string; code: number }) => void)
			| undefined;
		const pendingExec = new Promise<{
			stdout: string;
			stderr: string;
			code: number;
		}>((resolve) => {
			resolveExec = resolve;
		});
		const completeTask = vi.fn(async () => undefined);
		const client = {
			completeTask,
		};
		const exec = vi.fn(() => pendingExec);
		extension(h.pi, {
			loadConfig: async () => config({ [root]: MERGE_TD }),
			createTodoistClient: () => client as unknown as TodoistClient,
			exec,
		});
		await h.handlers.get(SESSION_START)?.(
			{ type: SESSION_START, reason: STARTUP },
			h.ctx,
		);
		const mergePromise = h.handlers.get(TOOL_RESULT)?.(
			{
				type: TOOL_RESULT,
				toolName: BASH,
				input: { command: GIT_MERGE_FEATURE_AUTH },
				isError: false,
			},
			h.ctx,
		);
		await Promise.resolve();
		await h.tools[0].execute(
			CALL,
			{ action: CLEAR_TASK },
			undefined,
			undefined,
			h.ctx,
		);
		resolveExec?.({
			stdout: JSON.stringify({ headRefName: FEATURE_AUTH }),
			stderr: EMPTY_STRING,
			code: 0,
		});
		await mergePromise;

		expect(completeTask).not.toHaveBeenCalled();
	});

	it.skip(SERIALIZES_CONCURRENT_TASK_CLAIMS, async () => {
		const root = await mkdtemp(join(tmpdir(), PI_TODO_GATE_EXTENSION));
		const h = harness(root);
		let releaseFirst: (() => void) | undefined;
		const firstClaim = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		const claimedRefs: string[] = [];
		const client = {
			resolveProject: async () => ({ id: PROJECT_1, name: MERGE_TD }),
			claimTask: async (ref: string) => {
				claimedRefs.push(ref);
				if (ref === TASK_A) await firstClaim;
				return {
					id: ref,
					content: ref,
					webUrl: `https://app.todoist.com/app/task/${ref}`,
					projectId: PROJECT_1,
				};
			},
		};
		extension(h.pi, {
			loadConfig: async () => config({ [root]: MERGE_TD }),
			createTodoistClient: () => client as unknown as TodoistClient,
		});
		await h.handlers.get(SESSION_START)?.(
			{ type: SESSION_START, reason: STARTUP },
			h.ctx,
		);
		const first = h.tools[0].execute(
			CALL,
			{ action: SET_TASK, task: TASK_A },
			undefined,
			undefined,
			h.ctx,
		);
		await new Promise((resolve) => setTimeout(resolve, 0));
		const second = h.tools[0].execute(
			CALL,
			{ action: SET_TASK, task: TASK_B },
			undefined,
			undefined,
			h.ctx,
		);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(claimedRefs).toEqual([TASK_A]);
		releaseFirst?.();
		await first;
		await second;
		expect(claimedRefs).toEqual([TASK_A, TASK_B]);
		expect(h.appended.at(-1)).toMatchObject({
			data: { taskRef: TASK_B },
		});
	});

	it.skip(CLEARS_INFERRED_TASK_AFTER_PENDING_CLAIM, async () => {
		const root = await mkdtemp(join(tmpdir(), PI_TODO_GATE_EXTENSION));
		const h = harness(root);
		let releaseClaim: (() => void) | undefined;
		const pendingClaim = new Promise<void>((resolve) => {
			releaseClaim = resolve;
		});
		const client = {
			resolveProject: async () => ({ id: PROJECT_1, name: MERGE_TD }),
			claimTask: async () => {
				await pendingClaim;
				return {
					id: INFERRED_TASK,
					content: INFERRED_TASK,
					webUrl: `https://app.todoist.com/app/task/${INFERRED_TASK}`,
					projectId: PROJECT_1,
				};
			},
		};
		extension(h.pi, {
			loadConfig: async () => config({ [root]: MERGE_TD }),
			createTodoistClient: () => client as unknown as TodoistClient,
		});
		await h.handlers.get(SESSION_START)?.(
			{ type: SESSION_START, reason: STARTUP },
			h.ctx,
		);
		const inference = h.handlers.get(BEFORE_AGENT_START)?.(
			{
				type: BEFORE_AGENT_START,
				prompt: `claimed Todoist task id:${INFERRED_TASK}`,
			},
			h.ctx,
		);
		await new Promise((resolve) => setTimeout(resolve, 0));
		const clearing = h.tools[0].execute(
			CALL,
			{ action: CLEAR_TASK },
			undefined,
			undefined,
			h.ctx,
		);
		let clearFinished = false;
		void Promise.resolve(clearing).then(() => {
			clearFinished = true;
		});
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(clearFinished).toBe(true);
		releaseClaim?.();
		await inference;
		await clearing;

		expect(h.appended.at(-1)).toMatchObject({ data: {} });
		expect(h.appended.at(-1)).not.toMatchObject({
			data: { taskRef: INFERRED_TASK },
		});
	});

	it.skip(CLEARS_SET_TASK_DURING_PENDING_CLAIM, async () => {
		const root = await mkdtemp(join(tmpdir(), PI_TODO_GATE_EXTENSION));
		const h = harness(root);
		let releaseClaim: (() => void) | undefined;
		const pendingClaim = new Promise<void>((resolve) => {
			releaseClaim = resolve;
		});
		const client = {
			resolveProject: async () => ({ id: PROJECT_1, name: MERGE_TD }),
			claimTask: async () => {
				await pendingClaim;
				return {
					id: TASK_A,
					content: TASK_A,
					webUrl: `https://app.todoist.com/app/task/${TASK_A}`,
					projectId: PROJECT_1,
				};
			},
		};
		extension(h.pi, {
			loadConfig: async () => config({ [root]: MERGE_TD }),
			createTodoistClient: () => client as unknown as TodoistClient,
		});
		await h.handlers.get(SESSION_START)?.(
			{ type: SESSION_START, reason: STARTUP },
			h.ctx,
		);
		const setting = h.tools[0].execute(
			CALL,
			{ action: SET_TASK, task: TASK_A },
			undefined,
			undefined,
			h.ctx,
		);
		await new Promise((resolve) => setTimeout(resolve, 0));
		const clearing = h.tools[0].execute(
			CALL,
			{ action: CLEAR_TASK },
			undefined,
			undefined,
			h.ctx,
		);
		let clearFinished = false;
		void Promise.resolve(clearing).then(() => {
			clearFinished = true;
		});
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(clearFinished).toBe(true);
		releaseClaim?.();
		await setting;
		await clearing;
		expect(h.appended.at(-1)).toMatchObject({ data: {} });
		expect(h.appended.at(-1)).not.toMatchObject({
			data: { taskRef: TASK_A },
		});
	});

	it.skip(IGNORES_STALE_CLAIM_ERROR, async () => {
		const root = await mkdtemp(join(tmpdir(), PI_TODO_GATE_EXTENSION));
		const h = harness(root);
		let rejectClaim: ((error: Error) => void) | undefined;
		const pendingClaim = new Promise<never>((_resolve, reject) => {
			rejectClaim = reject;
		});
		const client = {
			resolveProject: async () => ({ id: PROJECT_1, name: MERGE_TD }),
			claimTask: async () => pendingClaim,
		};
		extension(h.pi, {
			loadConfig: async () => config({ [root]: MERGE_TD }),
			createTodoistClient: () => client as unknown as TodoistClient,
		});
		await h.handlers.get(SESSION_START)?.(
			{ type: SESSION_START, reason: STARTUP },
			h.ctx,
		);
		const setting = h.tools[0].execute(
			CALL,
			{ action: SET_TASK, task: TASK_A },
			undefined,
			undefined,
			h.ctx,
		);
		await new Promise((resolve) => setTimeout(resolve, 0));
		const clearing = h.tools[0].execute(
			CALL,
			{ action: CLEAR_TASK },
			undefined,
			undefined,
			h.ctx,
		);
		await clearing;
		rejectClaim?.(new Error(TODOIST_UNAVAILABLE));
		await expect(setting).resolves.toBeDefined();
		expect(h.appended.at(-1)).toMatchObject({ data: {} });
	});

	it.skip(DOES_NOT_COMPLETE_ABA_RECLAIM, async () => {
		const root = await mkdtemp(join(tmpdir(), PI_TODO_GATE_EXTENSION));
		const h = harness(root, [
			{
				type: CUSTOM,
				customType: PI_TODO_GATE_STATE_ENTRY,
				data: {
					prUrl: HTTPS_GITHUB_COM_O_R_PULL_42_2,
					taskRef: TASK_1,
					taskName: TASK_NAME,
					taskUrl: TASK_URL,
				},
			},
		]);
		let resolveExec: (() => void) | undefined;
		const execReady = new Promise<void>((resolve) => {
			resolveExec = resolve;
		});
		const completeTask = vi.fn(async () => undefined);
		const client = {
			resolveProject: async () => ({ id: PROJECT_1, name: MERGE_TD }),
			claimTask: async () => ({
				id: TASK_1,
				content: TASK_NAME,
				webUrl: TASK_URL,
				projectId: PROJECT_1,
			}),
			completeTask,
		};
		const exec = async () => {
			await execReady;
			return {
				stdout: JSON.stringify({ headRefName: FEATURE_AUTH }),
				stderr: EMPTY_STRING,
				code: 0,
			};
		};
		extension(h.pi, {
			loadConfig: async () => config({ [root]: MERGE_TD }),
			createTodoistClient: () => client as unknown as TodoistClient,
			exec,
		});
		await h.handlers.get(SESSION_START)?.(
			{ type: SESSION_START, reason: STARTUP },
			h.ctx,
		);
		const mergePromise = h.handlers.get(TOOL_RESULT)?.(
			{
				type: TOOL_RESULT,
				toolName: BASH,
				input: { command: GIT_MERGE_FEATURE_AUTH },
				isError: false,
			},
			h.ctx,
		);
		await new Promise((resolve) => setTimeout(resolve, 0));
		await h.tools[0].execute(
			CALL,
			{ action: CLEAR_TASK },
			undefined,
			undefined,
			h.ctx,
		);
		await h.tools[0].execute(
			CALL,
			{ action: SET_TASK, task: TASK_1 },
			undefined,
			undefined,
			h.ctx,
		);
		resolveExec?.();
		await mergePromise;

		const latest = (h.appended.at(-1) as { data: Record<string, unknown> })
			.data;
		expect(latest).toMatchObject({ taskRef: TASK_1 });
		expect(latest).not.toHaveProperty("mergeCompletedAt");
	});

	it.skip(DOES_NOT_OVERWRITE_NEWER_STATE_AFTER_COMPLETION, async () => {
		const root = await mkdtemp(join(tmpdir(), PI_TODO_GATE_EXTENSION));
		const h = harness(root, [
			{
				type: CUSTOM,
				customType: PI_TODO_GATE_STATE_ENTRY,
				data: {
					prUrl: HTTPS_GITHUB_COM_O_R_PULL_42_2,
					taskRef: TASK_1,
				},
			},
		]);
		let resolveCompletion: (() => void) | undefined;
		const completion = new Promise<void>((resolve) => {
			resolveCompletion = resolve;
		});
		const completeTask = vi.fn(() => completion);
		const client = {
			completeTask,
		};
		const exec = async () => ({
			stdout: JSON.stringify({ headRefName: FEATURE_AUTH }),
			stderr: EMPTY_STRING,
			code: 0,
		});
		extension(h.pi, {
			loadConfig: async () => config({ [root]: MERGE_TD }),
			createTodoistClient: () => client as unknown as TodoistClient,
			exec,
		});
		await h.handlers.get(SESSION_START)?.(
			{ type: SESSION_START, reason: STARTUP },
			h.ctx,
		);
		const mergePromise = h.handlers.get(TOOL_RESULT)?.(
			{
				type: TOOL_RESULT,
				toolName: BASH,
				input: { command: GIT_MERGE_FEATURE_AUTH },
				isError: false,
			},
			h.ctx,
		);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(completeTask).toHaveBeenCalledWith(TASK_1, expect.any(Function));
		const clearing = h.tools[0].execute(
			CALL,
			{ action: CLEAR_TASK },
			undefined,
			undefined,
			h.ctx,
		);
		await new Promise((resolve) => setTimeout(resolve, 0));
		resolveCompletion?.();
		await mergePromise;
		await clearing;

		expect(h.appended.at(-1)).toEqual({
			type: PI_TODO_GATE_STATE_ENTRY,
			data: {
				prUrl: HTTPS_GITHUB_COM_O_R_PULL_42_2,
				prDiscoveryDisabled: true,
			},
		});
	});

	it(DOES_NOT_COMPLETE_BEFORE_EXIT_ACTION, async () => {
		const root = await mkdtemp(join(tmpdir(), PI_TODO_GATE_EXTENSION));
		const h = harness(root, [
			{
				type: CUSTOM,
				customType: PI_TODO_GATE_STATE_ENTRY,
				data: {
					prUrl: HTTPS_GITHUB_COM_O_R_PULL_42_2,
					taskRef: TASK_1,
				},
			},
		]);
		const completeTask = vi.fn();
		const client = { completeTask };
		const exec = async () => ({
			stdout: JSON.stringify({ headRefName: FEATURE_AUTH }),
			stderr: EMPTY_STRING,
			code: 0,
		});
		extension(h.pi, {
			loadConfig: async () => config({ [root]: MERGE_TD }),
			createTodoistClient: () => client as unknown as TodoistClient,
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
		expect(completeTask).not.toHaveBeenCalled();
		expect(h.appended).toHaveLength(0);
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
