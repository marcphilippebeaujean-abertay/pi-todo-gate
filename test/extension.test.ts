import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import extension from "../extensions/pi-todo-gate.ts";
import type { TodoistClient } from "../src/todoist.ts";

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
		mode: "print",
		ui: {
			theme: { fg: (_color: string, text: string) => text },
			notify: (message: string) => notifications.push(message),
			setFooter: (factory: unknown) => footerCalls.push(factory),
			setStatus: (key: string, text: string | undefined) =>
				statusCalls.push({ key, text }),
		},
		sessionManager: {
			getBranch: () => branch,
			getSessionId: () => "session-current",
			getSessionFile: () => "/sessions/current.jsonl",
			getSessionDir: () => "/sessions",
		},
		exec: async () => ({ stdout: "", stderr: "", code: 0 }),
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
	await h.handlers.get("session_start")?.(
		{ type: "session_start", reason: "startup" },
		h.ctx,
	);
}

describe("lazy activation", () => {
	it("does not register tools or perform external work for an unmatched project", async () => {
		const h = harness("/unconfigured/project");
		await start(h, { "/configured": "merge-td" });
		expect(h.tools).toHaveLength(0);
		expect(h.appended).toHaveLength(0);
	});

	it("registers the state tool only for a matched project", async () => {
		const h = harness("/configured/project");
		await start(h, { "/configured": "merge-td" });
		expect(h.tools.map((tool) => tool.name)).toEqual(["pi_todo_gate_state"]);
	});

	it("keeps native footer and publishes PR/task statuses", async () => {
		const h = harness("/configured/project");
		h.ctx.mode = "tui";
		await start(h, { "/configured": "merge-td" });
		expect(h.footerCalls).toEqual([undefined]);
		expect(h.statusCalls).toEqual([
			{ key: "pi-todo-gate-pr", text: "| PR Link: none |" },
			{ key: "pi-todo-gate-task", text: "Todoist Task: none" },
		]);
	});
});

describe("Todoist task lifecycle", () => {
	it("claims tasks without extra task operations", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-todo-gate-task-lifecycle-"));
		const h = harness(root);
		const accessed: string[] = [];
		const client = new Proxy(
			{
				resolveProject: async () => ({ id: "project-1", name: "merge-td" }),
				claimTask: async (ref: string) => ({
					id: ref,
					content: "Implement feature",
					webUrl: `https://app.todoist.com/app/task/${ref}`,
					projectId: "project-1",
				}),
			},
			{
				get(target, property, receiver) {
					if (!(property in target)) accessed.push(String(property));
					return Reflect.get(target, property, receiver);
				},
			},
		) as unknown as TodoistClient;
		extension(h.pi, {
			loadConfig: async () => config({ [root]: "merge-td" }),
			createTodoistClient: () => client,
		});
		await h.handlers.get("session_start")?.(
			{ type: "session_start", reason: "startup" },
			h.ctx,
		);

		await expect(
			h.tools[0].execute(
				"call",
				{ action: "set_task", task: "42" },
				undefined,
				undefined,
				h.ctx,
			),
		).resolves.toMatchObject({
			content: [{ text: expect.stringContaining("Claimed Todoist task") }],
		});
		expect(accessed).toEqual([]);
	});
});

describe("automatic Todoist task linking", () => {
	it("links a claimed task from session history and refreshes the footer", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-todo-gate-auto-link-"));
		const h = harness(root, [
			{
				type: "message",
				message: {
					role: "assistant",
					content: [
						{
							type: "text",
							text: "Claimed Todoist task https://app.todoist.com/app/task/42",
						},
					],
				},
			},
		]);
		const client: any = {
			resolveProject: async () => ({ id: "project-1", name: "merge-td" }),
			claimTask: async () => ({
				id: "42",
				content: "Implement feature",
				webUrl: "https://app.todoist.com/app/task/42",
				projectId: "project-1",
			}),
		};
		extension(h.pi, {
			loadConfig: async () => config({ [root]: "merge-td" }),
			createTodoistClient: () => client,
		});
		await h.handlers.get("session_start")?.(
			{ type: "session_start", reason: "startup" },
			h.ctx,
		);

		expect(h.appended.at(-1)).toEqual({
			type: "pi-todo-gate-state",
			data: {
				taskRef: "42",
				taskName: "Implement feature",
				taskUrl: "https://app.todoist.com/app/task/42",
			},
		});
		expect(h.statusCalls.at(-1)).toEqual({
			key: "pi-todo-gate-task",
			text: expect.stringContaining("Implement featu..."),
		});
	});

	it("links a task URL from history when the current prompt confirms the claim", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-todo-gate-prompt-link-"));
		const h = harness(root, [
			{
				type: "message",
				message: {
					role: "assistant",
					content: "Todoist task URL: https://app.todoist.com/app/task/42",
				},
			},
		]);
		const client: any = {
			resolveProject: async () => ({ id: "project-1", name: "merge-td" }),
			claimTask: async () => ({
				id: "42",
				content: "Implement feature",
				webUrl: "https://app.todoist.com/app/task/42",
				projectId: "project-1",
			}),
		};
		extension(h.pi, {
			loadConfig: async () => config({ [root]: "merge-td" }),
			createTodoistClient: () => client,
		});
		await h.handlers.get("session_start")?.(
			{ type: "session_start", reason: "startup" },
			h.ctx,
		);
		expect(h.appended).toHaveLength(0);

		await h.handlers.get("before_agent_start")?.(
			{
				type: "before_agent_start",
				prompt: "Claimed Todoist task for this session.",
			},
			h.ctx,
		);

		expect(h.appended.at(-1)).toEqual({
			type: "pi-todo-gate-state",
			data: {
				taskRef: "42",
				taskName: "Implement feature",
				taskUrl: "https://app.todoist.com/app/task/42",
			},
		});
	});

	it("links a successfully moved task as soon as its tool result arrives", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-todo-gate-tool-link-"));
		const h = harness(root);
		const client: any = {
			resolveProject: async () => ({ id: "project-1", name: "merge-td" }),
			claimTask: async () => ({
				id: "42",
				content: "Implement feature",
				webUrl: "https://app.todoist.com/app/task/42",
				projectId: "project-1",
			}),
		};
		extension(h.pi, {
			loadConfig: async () => config({ [root]: "merge-td" }),
			createTodoistClient: () => client,
		});
		await h.handlers.get("session_start")?.(
			{ type: "session_start", reason: "startup" },
			h.ctx,
		);

		await h.handlers.get("tool_result")?.(
			{
				type: "tool_result",
				toolName: "bash",
				input: { command: "td task view 42" },
				content: [{ type: "text", text: "Todoist task is claimed: 42" }],
				isError: false,
			},
			h.ctx,
		);

		expect(h.appended.at(-1)).toEqual({
			type: "pi-todo-gate-state",
			data: {
				taskRef: "42",
				taskName: "Implement feature",
				taskUrl: "https://app.todoist.com/app/task/42",
			},
		});
		expect(h.statusCalls.at(-1)?.text).toContain("Implement featu...");
	});

	it("does not treat the missing-task warning as a claim", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-todo-gate-negative-link-"));
		const h = harness(root, [
			{
				type: "message",
				message: {
					role: "assistant",
					content: "Todoist task URL: https://app.todoist.com/app/task/42",
				},
			},
		]);
		await start(h, { [root]: "merge-td" });
		await h.handlers.get("before_agent_start")?.(
			{
				type: "before_agent_start",
				prompt: "You have no claimed a Todoist task yet!",
			},
			h.ctx,
		);
		expect(h.appended).toHaveLength(0);
	});
});

describe("hidden lifecycle context", () => {
	it("warns on every prompt only when no task is active", async () => {
		const h = harness("/configured/project");
		await start(h, { "/configured": "merge-td" });
		const result = await h.handlers.get("before_agent_start")?.(
			{ type: "before_agent_start", prompt: "work" },
			h.ctx,
		);
		expect(result.message.content).toContain(
			"you have no claimed a todoist task yet!",
		);

		const withTask = harness("/configured/project", [
			{
				type: "custom",
				customType: "pi-todo-gate-state",
				data: { taskRef: "42", taskUrl: "https://app.todoist.com/app/task/42" },
			},
		]);
		await start(withTask, { "/configured": "merge-td" });
		const second = await withTask.handlers.get("before_agent_start")?.(
			{ type: "before_agent_start", prompt: "work" },
			withTask.ctx,
		);
		expect(second).toBeUndefined();
	});

	it("discovers the first PR URL and ignores later URLs", async () => {
		const h = harness("/configured/project", [
			{
				type: "message",
				message: {
					role: "user",
					content: [{ type: "text", text: "https://github.com/o/r/pull/1" }],
				},
			},
		]);
		await start(h, { "/configured": "merge-td" });
		await h.handlers.get("message_end")?.(
			{
				type: "message_end",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "https://github.com/o/r/pull/2" }],
				},
			},
			h.ctx,
		);
		expect(h.appended).toEqual([
			{
				type: "pi-todo-gate-state",
				data: { prUrl: "https://github.com/o/r/pull/1" },
			},
		]);
		await h.handlers.get("message_end")?.(
			{
				type: "message_end",
				message: {
					role: "assistant",
					content: "https://github.com/o/r/pull/3",
				},
			},
			h.ctx,
		);
		expect(h.appended).toHaveLength(1);
	});

	it("never sends hidden lifecycle messages through send APIs", async () => {
		const h = harness("/configured/project");
		let sent = 0;
		h.pi.sendMessage = () => {
			sent += 1;
		};
		h.pi.sendUserMessage = () => {
			sent += 1;
		};
		await start(h, { "/configured": "merge-td" });
		expect(sent).toBe(0);
	});
});

describe("pi_todo_gate_state", () => {
	it("validates and persists an explicit PR override", async () => {
		const h = harness("/configured/project", [
			{
				type: "custom",
				customType: "pi-todo-gate-state",
				data: {
					prUrl: "https://github.com/o/r/pull/1",
					mergeCompletedAt: "old",
					todoistCompletionAttemptedAt: "old",
				},
			},
		]);
		await start(h, { "/configured": "merge-td" });
		const result = await h.tools[0].execute(
			"call",
			{ action: "set_pr", url: "https://github.com/o/r/pull/42?tab=files" },
			undefined,
			undefined,
			h.ctx,
		);
		expect(h.appended.at(-1)).toEqual({
			type: "pi-todo-gate-state",
			data: { prUrl: "https://github.com/o/r/pull/42" },
		});
		expect(result.content[0].text).toContain("42");
		expect(h.statusCalls.slice(-2)).toEqual([
			{ key: "pi-todo-gate-pr", text: expect.stringContaining("PR Link:") },
			{ key: "pi-todo-gate-task", text: "Todoist Task: none" },
		]);
	});

	it("cleans up configured UI when a session becomes inactive", async () => {
		const h = harness("/configured/project");
		await start(h, { "/configured": "merge-td" });
		await h.handlers.get("session_start")?.(
			{ type: "session_start", reason: "resume" },
			{ ...h.ctx, cwd: "/unconfigured" },
		);
		expect(h.footerCalls.at(-1)).toBeUndefined();
	});

	it("does not inherit state from another coding project", async () => {
		const h = harness("/configured");
		extension(h.pi, {
			loadConfig: async () =>
				config({ "/configured": "parent", "/configured/project": "child" }),
			openSession: () => ({
				getBranch: () => [
					{
						type: "custom",
						customType: "pi-todo-gate-state",
						data: { prUrl: "https://github.com/o/r/pull/1" },
					},
				],
				getSessionId: () => "previous",
				getCwd: () => "/configured/project",
			}),
		});
		await h.handlers.get("session_start")?.(
			{
				type: "session_start",
				reason: "resume",
				previousSessionFile: "/sessions/previous.jsonl",
			},
			h.ctx,
		);
		expect(h.appended).toHaveLength(0);
	});

	it("clearing a task clears its completion metadata", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-todo-gate-extension-"));
		const h = harness(root, [
			{
				type: "custom",
				customType: "pi-todo-gate-state",
				data: {
					taskRef: "task-1",
					mergeCompletedAt: "old",
					todoistCompletionAttemptedAt: "old",
				},
			},
		]);
		extension(h.pi, {
			loadConfig: async () => config({ [root]: "merge-td" }),
		});
		await h.handlers.get("session_start")?.(
			{ type: "session_start", reason: "startup" },
			h.ctx,
		);
		await h.tools[0].execute(
			"call",
			{ action: "clear_task" },
			undefined,
			undefined,
			h.ctx,
		);
		expect(h.appended.at(-1)).toEqual({
			type: "pi-todo-gate-state",
			data: {},
		});
	});

	it("records failed Todoist completion attempts", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-todo-gate-extension-"));
		const h = harness(root, [
			{
				type: "custom",
				customType: "pi-todo-gate-state",
				data: {
					prUrl: "https://github.com/o/r/pull/42",
					taskRef: "task-1",
				},
			},
		]);
		const client: any = {
			completeTask: async () => {
				throw new Error("Todoist unavailable");
			},
		};
		const exec = async () => ({
			stdout: JSON.stringify({ headRefName: "feature/auth" }),
			stderr: "",
			code: 0,
		});
		extension(h.pi, {
			loadConfig: async () => config({ [root]: "merge-td" }),
			createTodoistClient: () => client,
			exec,
		});
		await h.handlers.get("session_start")?.(
			{ type: "session_start", reason: "startup" },
			h.ctx,
		);
		await h.handlers.get("tool_result")?.(
			{
				type: "tool_result",
				toolName: "bash",
				input: { command: "git merge feature/auth" },
				isError: false,
			},
			h.ctx,
		);
		expect(
			(h.appended.at(-1) as { data: { todoistCompletionAttemptedAt?: string } })
				.data.todoistCompletionAttemptedAt,
		).toEqual(expect.any(String));
	});

	it("rejects invalid PR URLs without persisting them", async () => {
		const h = harness("/configured/project");
		await start(h, { "/configured": "merge-td" });
		await expect(
			h.tools[0].execute(
				"call",
				{ action: "set_pr", url: "https://example.com/pr/42" },
				undefined,
				undefined,
				h.ctx,
			),
		).rejects.toThrow();
		expect(h.appended).toHaveLength(0);
	});
});
