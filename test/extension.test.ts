import { describe, expect, it } from "vitest";
import extension from "../extensions/pi-todo-gate.ts";

function harness(cwd: string, branch: unknown[] = []) {
	const handlers = new Map<
		string,
		(event: any, ctx: any) => Promise<any> | any
	>();
	const tools: any[] = [];
	const appended: unknown[] = [];
	const notifications: string[] = [];
	const statusCalls: Array<{ key: string; text: string | undefined }> = [];
	let activeTools: string[] = [];
	const pi: any = {
		on: (event: string, handler: any) => handlers.set(event, handler),
		registerTool: (tool: any) => tools.push(tool),
		appendEntry: (type: string, data: unknown) => appended.push({ type, data }),
		getActiveTools: () => activeTools,
		setActiveTools: (names: string[]) => {
			activeTools = names;
		},
	};
	const ctx: any = {
		cwd,
		mode: "print",
		ui: {
			theme: { fg: (_color: string, text: string) => text },
			notify: (message: string) => notifications.push(message),
			setStatus: (key: string, text: string | undefined) =>
				statusCalls.push({ key, text }),
		},
		sessionManager: {
			getBranch: () => branch,
			getSessionId: () => "session-current",
			getCwd: () => cwd,
		},
	};
	return { pi, ctx, handlers, tools, appended, notifications, statusCalls };
}

const config = (projects: Record<string, string>) => ({ projects });

async function start(
	h: ReturnType<typeof harness>,
	projects: Record<string, string>,
	dependencies: Record<string, unknown> = {},
) {
	extension(h.pi, {
		loadConfig: async () => config(projects),
		...dependencies,
	});
	await h.handlers.get("session_start")?.(
		{ type: "session_start", reason: "startup" },
		h.ctx,
	);
}

describe("extension activation", () => {
	it("does not register behavior inside dispatched subagents", () => {
		const h = harness("/project");
		const previous = process.env.PI_SUBAGENT_CHILD;
		process.env.PI_SUBAGENT_CHILD = "1";
		try {
			extension(h.pi, { loadConfig: async () => config({}) });
		} finally {
			if (previous === undefined) delete process.env.PI_SUBAGENT_CHILD;
			else process.env.PI_SUBAGENT_CHILD = previous;
		}
		expect(h.handlers.size).toBe(0);
		expect(h.tools).toHaveLength(0);
	});

	it("loads PR behavior without Todoist configuration", async () => {
		const h = harness("/unconfigured/project", [
			{
				type: "message",
				message: {
					role: "assistant",
					content: "https://github.com/o/r/pull/42",
				},
			},
		]);
		await start(h, {});
		expect(h.tools.map((tool) => tool.name)).toEqual(["pi_pr_gate_state"]);
		expect(h.appended.at(-1)).toEqual({
			type: "pi-pr-gate-state",
			data: {
				prUrl: "https://github.com/o/r/pull/42",
				discoveryDisabled: false,
			},
		});
	});

	it("loads separate PR and Todoist tools for configured projects", async () => {
		const h = harness("/configured/project");
		await start(h, { "/configured": "Merge TD" });
		expect(h.tools.map((tool) => tool.name)).toEqual([
			"pi_pr_gate_state",
			"pi_todoist_gate_state",
		]);
		expect(h.statusCalls.map(({ key }) => key)).toEqual([
			"pi-todo-gate-pr",
			"pi-todo-gate-task",
		]);
	});
});

describe("Todoist context composition", () => {
	it("adds new-task workflow when no task is tracked", async () => {
		const h = harness("/configured/project");
		await start(h, { "/configured": "Merge TD" });
		const result = await h.handlers.get("before_agent_start")?.(
			{ type: "before_agent_start", prompt: "implement feature" },
			h.ctx,
		);
		expect(result.message.content).toContain("# Todoist Task Gate (MANDATORY)");
		expect(result.message.content).toContain(
			"Configured Todoist project: Merge TD",
		);
		expect(result.message.content).toContain(
			"Find or create a Todoist task matching this work",
		);
		expect(result.message.content).toContain(
			"pi_todoist_gate_state using set_task",
		);
	});

	it("continues current task tracking without new-task instructions", async () => {
		const h = harness("/configured/project", [
			{
				type: "custom",
				customType: "pi-todoist-gate-state",
				data: {
					taskRef: "42",
					taskName: "Implement feature",
					taskUrl: "https://app.todoist.com/app/task/42",
				},
			},
		]);
		await start(h, { "/configured": "Merge TD" });
		const result = await h.handlers.get("before_agent_start")?.(
			{ type: "before_agent_start", prompt: "continue" },
			h.ctx,
		);
		expect(result.message.content).toContain(
			"We are tracking tasks with Todoist and you are currently working on task 42.",
		);
		expect(result.message.content).toContain(
			"Continue working on and tracking this task in Todoist.",
		);
		expect(result.message.content).not.toContain("Find or create");
	});

	it("inherits task state after context reset in the same configured project", async () => {
		const root = "/configured/project";
		const h = harness(root);
		extension(h.pi, {
			loadConfig: async () => config({ "/configured": "Merge TD" }),
			openSession: () => ({
				getBranch: () => [
					{
						type: "custom",
						customType: "pi-todoist-gate-state",
						data: { taskRef: "previous-task" },
					},
				],
				getCwd: () => root,
			}),
		});
		await h.handlers.get("session_start")?.(
			{
				type: "session_start",
				reason: "new",
				previousSessionFile: "/sessions/previous.jsonl",
			},
			h.ctx,
		);
		const result = await h.handlers.get("before_agent_start")?.(
			{ type: "before_agent_start", prompt: "continue" },
			h.ctx,
		);
		expect(result.message.content).toContain(
			"currently working on task previous-task",
		);
	});
});

describe("merge reminder", () => {
	it("clears merged PR, records exact URL, and reminds once", async () => {
		const h = harness("/project", [
			{
				type: "custom",
				customType: "pi-pr-gate-state",
				data: { prUrl: "https://github.com/o/r/pull/42" },
			},
		]);
		const exec = async (_command: string, args: string[]) => {
			if (args.includes("state,mergedAt"))
				return {
					stdout: JSON.stringify({
						state: "MERGED",
						mergedAt: "2026-08-30T00:00:00Z",
					}),
					stderr: "",
					code: 0,
				};
			return { stdout: "", stderr: "", code: 0 };
		};
		await start(h, {}, { exec });
		expect(h.appended.at(-1)).toMatchObject({
			type: "pi-pr-gate-state",
			data: {
				mergedPrs: [
					{
						prUrl: "https://github.com/o/r/pull/42",
						reminderPending: true,
					},
				],
			},
		});

		const first = await h.handlers.get("before_agent_start")?.(
			{ type: "before_agent_start", prompt: "continue" },
			h.ctx,
		);
		expect(first.message.content).toContain(
			"Please ensure you have closed all completed tasks for this session if you have been using task tracking",
		);
		expect(h.appended.at(-1)).toEqual({
			type: "pi-pr-gate-state",
			data: {
				discoveryDisabled: false,
				mergedPrs: [
					{
						prUrl: "https://github.com/o/r/pull/42",
						reminderPending: false,
						detectedAt: expect.any(String),
					},
				],
			},
		});

		const second = await h.handlers.get("before_agent_start")?.(
			{ type: "before_agent_start", prompt: "continue" },
			h.ctx,
		);
		expect(second?.message?.content ?? "").not.toContain("Please ensure");

		await h.handlers.get("message_end")?.(
			{
				type: "message_end",
				message: "New PR: https://github.com/o/r/pull/43",
			},
			h.ctx,
		);
		expect(h.appended.at(-1)).toEqual({
			type: "pi-pr-gate-state",
			data: {
				mergedPrs: expect.any(Array),
				prUrl: "https://github.com/o/r/pull/43",
				discoveryDisabled: false,
			},
		});
	});

	it("does not call Todoist completion after a merge", async () => {
		const h = harness("/configured/project", [
			{
				type: "custom",
				customType: "pi-pr-gate-state",
				data: { prUrl: "https://github.com/o/r/pull/42" },
			},
			{
				type: "custom",
				customType: "pi-todoist-gate-state",
				data: { taskRef: "task-1" },
			},
		]);
		let completions = 0;
		const client: any = {
			completeTask: async () => {
				completions += 1;
			},
		};
		const exec = async (_command: string, args: string[]) => {
			if (args.includes("state,mergedAt"))
				return {
					stdout: JSON.stringify({ state: "MERGED", mergedAt: "now" }),
					stderr: "",
					code: 0,
				};
			return { stdout: "", stderr: "", code: 0 };
		};
		await start(
			h,
			{ "/configured": "Merge TD" },
			{
				exec,
				createTodoistClient: () => client,
			},
		);
		expect(completions).toBe(0);
	});
});

describe("independent state tools", () => {
	it("sets Todoist task through Todoist tool only", async () => {
		const h = harness("/configured/project");
		const client: any = {
			resolveProject: async () => ({ id: "project-1", name: "Merge TD" }),
			claimTask: async (ref: string) => ({
				id: ref,
				content: "Implement feature",
				webUrl: `https://app.todoist.com/app/task/${ref}`,
				projectId: "project-1",
			}),
		};
		await start(
			h,
			{ "/configured": "Merge TD" },
			{
				createTodoistClient: () => client,
			},
		);
		const todoistTool = h.tools.find(
			(tool) => tool.name === "pi_todoist_gate_state",
		);
		await expect(
			todoistTool.execute(
				"call",
				{ action: "set_task", task: "42" },
				undefined,
				undefined,
				h.ctx,
			),
		).resolves.toMatchObject({
			content: [{ text: expect.stringContaining("Claimed Todoist task") }],
		});
		expect(h.appended.at(-1)).toEqual({
			type: "pi-todoist-gate-state",
			data: {
				taskRef: "42",
				taskName: "Implement feature",
				taskUrl: "https://app.todoist.com/app/task/42",
			},
		});
	});
});
