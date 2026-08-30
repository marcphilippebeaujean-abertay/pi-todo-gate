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
	it("does not activate inside dispatched subagents", async () => {
		const h = harness("/configured/project");
		let configLoads = 0;
		const previousSubagent = process.env.PI_SUBAGENT_CHILD;
		process.env.PI_SUBAGENT_CHILD = "1";
		try {
			extension(h.pi, {
				loadConfig: async () => {
					configLoads += 1;
					return config({ "/configured": "merge-td" });
				},
			});
		} finally {
			if (previousSubagent === undefined) delete process.env.PI_SUBAGENT_CHILD;
			else process.env.PI_SUBAGENT_CHILD = previousSubagent;
		}
		expect(h.handlers.size).toBe(0);
		expect(h.tools).toHaveLength(0);
		expect(configLoads).toBe(0);
	});

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

describe("task synchronization", () => {
	it("reads the task store from the active worktree", async () => {
		const configuredRoot = await mkdtemp(
			join(tmpdir(), "pi-todo-gate-project-"),
		);
		const worktree = join(configuredRoot, ".worktrees", "dialog-edit");
		const h = harness(worktree, [
			{
				type: "custom",
				customType: "pi-todo-gate-state",
				data: {
					taskRef: "parent",
					taskUrl: "https://app.todoist.com/app/task/parent",
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
			loadConfig: async () => config({ [configuredRoot]: "merge-td" }),
			createTodoistClient: () => client,
		});
		await h.handlers.get("session_start")?.(
			{ type: "session_start", reason: "startup" },
			h.ctx,
		);
		await writePiTaskStore(sessionTaskPath(worktree, "session-current"), {
			nextId: 2,
			tasks: [
				{
					id: "1",
					subject: "Worktree task",
					description: "",
					status: "pending",
					metadata: {},
					blocks: [],
					blockedBy: [],
					createdAt: 1,
					updatedAt: 1,
				},
			],
		});
		await h.handlers.get("agent_settled")?.({ type: "agent_settled" }, h.ctx);
		await vi.waitFor(() => {
			expect(created).toEqual(["parent:[ ] Worktree task"]);
		});
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
			listDescendants: async () => [],
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
			listDescendants: async () => [],
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
			listDescendants: async () => [],
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

	it("never sends synchronization messages to the agent", async () => {
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
			createTodoistClient: () => ({ listDescendants: async () => [] }) as any,
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

	it("does not run a pending old-parent sync after switching tasks", async () => {
		vi.useFakeTimers();
		try {
			const root = await mkdtemp(join(tmpdir(), "pi-todo-gate-extension-"));
			const h = harness(root, [
				{
					type: "custom",
					customType: "pi-todo-gate-state",
					data: { taskRef: "old" },
				},
			]);
			const calls: string[] = [];
			const client: any = {
				resolveProject: async () => ({ id: "project-1", name: "merge-td" }),
				claimTask: async (ref: string) => ({
					id: ref,
					webUrl: `https://app.todoist.com/app/task/${ref}`,
					projectId: "project-1",
				}),
				listDescendants: async (ref: string) => {
					calls.push(`list:${ref}`);
					return [];
				},
			};
			extension(h.pi, {
				loadConfig: async () => config({ [root]: "merge-td" }),
				createTodoistClient: () => client,
			});
			await h.handlers.get("session_start")?.(
				{ type: "session_start", reason: "startup" },
				h.ctx,
			);
			calls.length = 0;
			await h.handlers.get("agent_settled")?.({ type: "agent_settled" }, h.ctx);
			await h.tools[0].execute(
				"call",
				{ action: "set_task", task: "new" },
				undefined,
				undefined,
				h.ctx,
			);
			await vi.advanceTimersByTimeAsync(30);
			expect(calls).toEqual(["list:new"]);
		} finally {
			vi.useRealTimers();
		}
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
			listDescendants: async () => [],
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

	it("does not outbound-sync after an inbound restore failure", async () => {
		vi.useFakeTimers();
		try {
			const root = await mkdtemp(join(tmpdir(), "pi-todo-gate-extension-"));
			const h = harness(root, [
				{
					type: "custom",
					customType: "pi-todo-gate-state",
					data: { taskRef: "old" },
				},
			]);
			let lists = 0;
			const client: any = {
				listDescendants: async () => {
					lists += 1;
					throw new Error("restore failed");
				},
			};
			extension(h.pi, {
				loadConfig: async () => config({ [root]: "merge-td" }),
				createTodoistClient: () => client,
			});
			await h.handlers.get("session_start")?.(
				{ type: "session_start", reason: "startup" },
				h.ctx,
			);
			await h.handlers.get("agent_settled")?.({ type: "agent_settled" }, h.ctx);
			await vi.advanceTimersByTimeAsync(30);
			expect(lists).toBe(1);
		} finally {
			vi.useRealTimers();
		}
	});

	it("switches tasks only after loading the new parent's subtasks", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-todo-gate-extension-"));
		const h = harness(root, [
			{
				type: "custom",
				customType: "pi-todo-gate-state",
				data: {
					taskRef: "old",
					taskUrl: "https://app.todoist.com/app/task/old",
				},
			},
		]);
		const calls: string[] = [];
		const client: any = {
			resolveProject: async () => ({ id: "project-1", name: "merge-td" }),
			claimTask: async (ref: string) => ({
				id: ref,
				content: "Add dialog controls",
				webUrl: `https://app.todoist.com/app/task/${ref}`,
				projectId: "project-1",
			}),
			listDescendants: async (ref: string) => {
				calls.push(`list:${ref}`);
				return [
					{
						id: "new-child",
						content: "[ ] New child",
						description: "",
						projectId: "project-1",
					},
				];
			},
		};
		extension(h.pi, {
			loadConfig: async () => config({ [root]: "merge-td" }),
			createTodoistClient: () => client,
		});
		await h.handlers.get("session_start")?.(
			{ type: "session_start", reason: "startup" },
			h.ctx,
		);
		calls.length = 0;
		await h.tools[0].execute(
			"call",
			{ action: "set_task", task: "new-parent" },
			undefined,
			undefined,
			h.ctx,
		);
		expect(calls).toEqual(["list:new-parent"]);
		expect(h.appended.at(-1)).toEqual({
			type: "pi-todo-gate-state",
			data: {
				taskRef: "new-parent",
				taskName: "Add dialog controls",
				taskUrl: "https://app.todoist.com/app/task/new-parent",
			},
		});
		await expect(
			readPiTaskStore(sessionTaskPath(root, "session-current")),
		).resolves.toMatchObject({
			tasks: [{ subject: "New child" }],
		});
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
