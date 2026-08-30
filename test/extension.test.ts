import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import extension from "../extensions/pi-todo-gate.ts";
import type { TodoistClient } from "../src/todoist/client.ts";
import { createTodoistModule } from "../src/todoist/module.ts";

type Handler = (event: unknown, ctx: unknown) => unknown;
type TestTool = {
	name: string;
	execute(...args: unknown[]): Promise<unknown>;
};

function harness(cwd: string, branch: unknown[] = []) {
	const handlers = new Map<string, Handler>();
	const tools: TestTool[] = [];
	const appended: unknown[] = [];
	const notifications: string[] = [];
	const statusCalls: Array<{ key: string; text: string | undefined }> = [];
	let activeTools: string[] = [];
	const pi = {
		on: (event: string, handler: Handler) => handlers.set(event, handler),
		registerTool: (tool: TestTool) => tools.push(tool),
		appendEntry: (type: string, data: unknown) => appended.push({ type, data }),
		getActiveTools: () => activeTools,
		setActiveTools: (names: string[]) => {
			activeTools = names;
		},
	} as unknown as ExtensionAPI;
	const ctx = {
		cwd,
		mode: "print",
		hasUI: true,
		ui: {
			theme: { fg: (_color: string, text: string) => text },
			notify: (message: string) => notifications.push(message),
			confirm: async () => true,
			setStatus: (key: string, text: string | undefined) =>
				statusCalls.push({ key, text }),
		},
		sessionManager: {
			getBranch: () => branch,
			getSessionId: () => "session-current",
			getCwd: () => cwd,
		},
	} as unknown as ExtensionContext;
	return { pi, ctx, handlers, tools, appended, notifications, statusCalls };
}

const config = (projects: Record<string, string>) => ({ projects });

type ContextResult = { message?: { content?: unknown } };

function contextContent(value: unknown): string {
	const content = (value as ContextResult | undefined)?.message?.content;
	return typeof content === "string" ? content : "";
}

async function start(
	h: ReturnType<typeof harness>,
	projects: Record<string, string>,
	dependencies: Record<string, unknown> = {},
) {
	extension(h.pi, {
		loadConfig: async () => config(projects),
		claimTaskWorker: async () => ({ status: "none" as const }),
		...dependencies,
	});
	await h.handlers.get("session_start")?.(
		{ type: "session_start", reason: "startup" },
		h.ctx,
	);
}

const projectExec = async (command: string, args: string[]) => {
	const key = [command, ...args].join(" ");
	if (key === "git rev-parse --show-toplevel")
		return { stdout: "/configured/project\n", stderr: "", code: 0 };
	if (key === "git branch --show-current")
		return { stdout: "feature\n", stderr: "", code: 0 };
	if (key === "git worktree list --porcelain")
		return {
			stdout: "worktree /configured\nHEAD abc\nbranch refs/heads/main\n",
			stderr: "",
			code: 0,
		};
	return { stdout: "", stderr: "", code: 0 };
};

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
		await start(
			h,
			{},
			{
				exec: async (command: string) =>
					command === "gh"
						? {
								stdout: '{"state":"OPEN","mergedAt":""}',
								stderr: "",
								code: 0,
							}
						: { stdout: "", stderr: "unavailable", code: 1 },
			},
		);
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

describe("Todoist prompt isolation", () => {
	it("does not add Todoist workflow when no task is tracked", async () => {
		const h = harness("/configured/project");
		await start(h, { "/configured": "Merge TD" });
		const result = await h.handlers.get("before_agent_start")?.(
			{ type: "before_agent_start", prompt: "implement feature" },
			h.ctx,
		);
		expect(contextContent(result)).toBe("");
	});

	it("does not add Todoist workflow for an active task", async () => {
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
		expect(contextContent(result)).toBe("");
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
		expect(contextContent(result)).toBe("");
	});

	it("does not inherit Todoist state after explicit clear", async () => {
		const root = "/configured/project";
		const h = harness(root, [
			{
				type: "custom",
				customType: "pi-todoist-gate-state",
				data: {},
			},
			{
				type: "message",
				message: {
					role: "assistant",
					content: "Claimed Todoist task https://app.todoist.com/app/task/42",
				},
			},
		]);
		extension(h.pi, {
			loadConfig: async () => config({ "/configured": "Merge TD" }),
			exec: async () => ({ stdout: "", stderr: "unavailable", code: 1 }),
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
			createTodoistClient: () =>
				({
					resolveProject: async () => ({ id: "project-1", name: "Merge TD" }),
					claimTask: async () => ({
						id: "42",
						content: "Stale task",
						webUrl: "https://app.todoist.com/app/task/42",
					}),
				}) as unknown as TodoistClient,
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
		expect(contextContent(result)).toBe("");
		expect(contextContent(result)).not.toContain("previous-task");
	});
});

describe("deferred Todoist task claiming", () => {
	it("runs claim worker once with first prompt, history, and project details", async () => {
		const h = harness("/configured/project", [
			{
				type: "message",
				message: { role: "user", content: "initial request" },
			},
		]);
		const inputs: unknown[] = [];
		const todoist = createTodoistModule(
			h.pi,
			{ codingRoot: "/configured", todoistProjectRef: "Pi Extensions" },
			{ projects: { "/configured": "Pi Extensions" } },
			{
				exec: projectExec,
				claimTaskWorker: async (input) => {
					inputs.push(input);
					return { status: "none" };
				},
			},
		);
		await todoist.sessionStart({}, h.ctx);
		await todoist.beforeAgentStart("Implement feature");
		await todoist.beforeAgentStart("second prompt");

		expect(inputs).toHaveLength(1);
		expect(inputs[0]).toMatchObject({
			prompt: "Implement feature",
			history: [expect.stringContaining("initial request")],
			cwd: "/configured/project",
			projectRef: "Pi Extensions",
			worktree: { isWorktree: true, branch: "feature" },
		});
	});

	it("persists claimed task without adding Todoist context", async () => {
		const h = harness("/configured/project");
		const client = {
			resolveProject: async () => ({ id: "project-1", name: "Pi Extensions" }),
			claimTask: async () => ({
				id: "42",
				content: "Implement feature",
				webUrl: "https://app.todoist.com/app/task/42",
				projectId: "project-1",
			}),
		} as unknown as TodoistClient;
		const todoist = createTodoistModule(
			h.pi,
			{ codingRoot: "/configured", todoistProjectRef: "Pi Extensions" },
			{ projects: { "/configured": "Pi Extensions" } },
			{
				exec: projectExec,
				createTodoistClient: () => client,
				claimTaskWorker: async () => ({
					status: "claimed",
					taskRef: "42",
				}),
			},
		);
		await todoist.sessionStart({}, h.ctx);

		expect(await todoist.beforeAgentStart("claim 42")).toBe("");
		expect(h.appended.at(-1)).toEqual({
			type: "pi-todoist-gate-state",
			data: {
				taskRef: "42",
				taskName: "Implement feature",
				taskUrl: "https://app.todoist.com/app/task/42",
			},
		});
	});

	it("asks before switching to colliding task", async () => {
		const h = harness("/configured/project");
		const confirm = vi.fn(async () => true);
		(h.ctx as unknown as { ui: { confirm: typeof confirm } }).ui.confirm =
			confirm;
		const client = {
			resolveProject: async () => ({ id: "project-1", name: "Pi Extensions" }),
			claimTask: async () => ({
				id: "42",
				content: "Implement feature",
				webUrl: "https://app.todoist.com/app/task/42",
				projectId: "project-1",
			}),
		} as unknown as TodoistClient;
		const todoist = createTodoistModule(
			h.pi,
			{ codingRoot: "/configured", todoistProjectRef: "Pi Extensions" },
			{ projects: { "/configured": "Pi Extensions" } },
			{
				exec: projectExec,
				createTodoistClient: () => client,
				claimTaskWorker: async () => ({
					status: "collision",
					taskRef: "42",
					taskName: "Implement feature",
				}),
			},
		);
		await todoist.sessionStart({}, h.ctx);
		await todoist.beforeAgentStart("claim 42");

		expect(confirm).toHaveBeenCalled();
		expect(h.appended.at(-1)).toMatchObject({
			data: { taskRef: "42" },
		});
	});

	it("skips worker when inherited task exists after new session", async () => {
		const h = harness("/configured/project");
		const worker = vi.fn(async () => ({ status: "none" as const }));
		const todoist = createTodoistModule(
			h.pi,
			{ codingRoot: "/configured", todoistProjectRef: "Pi Extensions" },
			{ projects: { "/configured": "Pi Extensions" } },
			{
				exec: projectExec,
				claimTaskWorker: worker,
				openSession: () => ({
					getBranch: () => [
						{
							type: "custom",
							customType: "pi-todoist-gate-state",
							data: { taskRef: "42" },
						},
					],
					getCwd: () => "/configured/project",
				}),
			},
		);
		await todoist.sessionStart(
			{ previousSessionFile: "/sessions/previous.jsonl" },
			h.ctx,
		);
		await todoist.beforeAgentStart("continue");

		expect(worker).not.toHaveBeenCalled();
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
		expect(contextContent(first)).toContain(
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
		expect(contextContent(second)).not.toContain("Please ensure");

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
		const client = {
			completeTask: async () => {
				completions += 1;
			},
		} as unknown as TodoistClient;
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

describe("PR link validation", () => {
	it("rejects a syntactically valid PR URL that GitHub cannot resolve", async () => {
		const h = harness("/repo");
		const exec = async () => ({
			stdout: "",
			stderr: "not found",
			code: 1,
		});
		await start(h, {}, { exec });

		const prTool = h.tools.find((tool) => tool.name === "pi_pr_gate_state");
		expect(prTool).toBeDefined();
		if (!prTool) throw new Error("PR tool was not registered");
		await expect(
			prTool.execute(
				"call",
				{
					action: "set_pr",
					url: "https://github.com/o/r/pull/42",
				},
				undefined,
				undefined,
				h.ctx,
			),
		).rejects.toThrow("existing GitHub pull request");
		expect(h.appended).toHaveLength(0);
	});

	it("does not auto-pin an unresolved PR URL from session history", async () => {
		const h = harness("/repo", [
			{
				type: "message",
				message: {
					role: "assistant",
					content: "https://github.com/o/r/pull/42",
				},
			},
		]);
		const exec = async () => ({
			stdout: "",
			stderr: "not found",
			code: 1,
		});

		await start(h, {}, { exec });

		expect(h.appended).toHaveLength(0);
	});

	it("skips an unresolved history URL and pins the next existing PR", async () => {
		const h = harness("/repo", [
			{
				type: "message",
				message: {
					role: "assistant",
					content:
						"https://github.com/o/r/pull/42 https://github.com/o/r/pull/43",
				},
			},
		]);
		const exec = async (command: string, args: string[]) => {
			if (command !== "gh") return { stdout: "", stderr: "", code: 1 };
			if (args[2] === "https://github.com/o/r/pull/43")
				return {
					stdout: '{"state":"OPEN","mergedAt":""}',
					stderr: "",
					code: 0,
				};
			return { stdout: "", stderr: "not found", code: 1 };
		};

		await start(h, {}, { exec });

		expect(h.appended.at(-1)).toEqual({
			type: "pi-pr-gate-state",
			data: {
				prUrl: "https://github.com/o/r/pull/43",
				discoveryDisabled: false,
			},
		});
	});

	it("does not restore a pending PR pin after clear_pr", async () => {
		const h = harness("/repo");
		let resolveLookup!: (result: {
			stdout: string;
			stderr: string;
			code: number;
		}) => void;
		const lookup = new Promise<{
			stdout: string;
			stderr: string;
			code: number;
		}>((resolve) => {
			resolveLookup = resolve;
		});
		const exec = async (command: string) => {
			if (command === "gh") return lookup;
			return { stdout: "", stderr: "", code: 1 };
		};

		await start(h, {}, { exec });
		const prTool = h.tools.find((tool) => tool.name === "pi_pr_gate_state");
		expect(prTool).toBeDefined();
		if (!prTool) throw new Error("PR tool was not registered");

		const pendingPin = prTool.execute(
			"call",
			{
				action: "set_pr",
				url: "https://github.com/o/r/pull/42",
			},
			undefined,
			undefined,
			h.ctx,
		);
		await prTool.execute(
			"call",
			{ action: "clear_pr" },
			undefined,
			undefined,
			h.ctx,
		);
		resolveLookup({
			stdout: '{"state":"OPEN","mergedAt":""}',
			stderr: "",
			code: 0,
		});
		await pendingPin;

		expect(h.appended.at(-1)).toMatchObject({
			type: "pi-pr-gate-state",
			data: { discoveryDisabled: true },
		});
		expect((h.appended.at(-1) as { data: { prUrl?: string } }).data.prUrl).toBe(
			undefined,
		);
	});
});

describe("PR lifecycle isolation", () => {
	it("does not forward a stale hook into the new Todoist module", async () => {
		const h = harness("/configured/project", [
			{
				type: "custom",
				customType: "pi-pr-gate-state",
				data: { prUrl: "https://github.com/o/r/pull/42" },
			},
		]);
		let blockBefore = false;
		let blocked = false;
		let releasePrLookup!: () => void;
		let prLookupStarted!: () => void;
		const prLookupReady = new Promise<void>((resolve) => {
			prLookupStarted = resolve;
		});
		const blockedPrLookup = new Promise<void>((resolve) => {
			releasePrLookup = resolve;
		});
		const exec = async (command: string) => {
			if (command === "gh" && blockBefore && !blocked) {
				blocked = true;
				prLookupStarted();
				await blockedPrLookup;
			}
			return command === "gh"
				? { stdout: '{"state":"OPEN","mergedAt":""}', stderr: "", code: 0 }
				: { stdout: "", stderr: "unavailable", code: 1 };
		};
		await start(
			h,
			{ "/configured": "Merge TD" },
			{ exec, createTodoistClient: () => ({}) as unknown as TodoistClient },
		);
		blockBefore = true;
		const staleBefore = h.handlers.get("before_agent_start")?.(
			{ type: "before_agent_start", prompt: "continue" },
			h.ctx,
		);
		await prLookupReady;
		const currentStart = h.handlers.get("session_start")?.(
			{ type: "session_start", reason: "new" },
			h.ctx,
		);
		await currentStart;
		releasePrLookup();

		expect(contextContent(await staleBefore)).toBe("");
	});

	it("does not duplicate Todoist tools after shutdown and restart", async () => {
		const h = harness("/configured/project");
		extension(h.pi, {
			loadConfig: async () => config({ "/configured": "Merge TD" }),
			exec: async () => ({ stdout: "", stderr: "unavailable", code: 1 }),
		});
		await h.handlers.get("session_start")?.(
			{ type: "session_start", reason: "startup" },
			h.ctx,
		);
		await h.handlers.get("session_shutdown")?.(
			{ type: "session_shutdown" },
			h.ctx,
		);
		await h.handlers.get("session_start")?.(
			{ type: "session_start", reason: "new" },
			h.ctx,
		);

		expect(
			h.tools.filter((tool) => tool.name === "pi_todoist_gate_state"),
		).toHaveLength(1);
	});

	it("does not install Todoist module from stale session initialization", async () => {
		const h = harness("/configured/project");
		let configCalls = 0;
		let configStarted!: () => void;
		let releaseConfig!: () => void;
		const configStartedSignal = new Promise<void>((resolve) => {
			configStarted = resolve;
		});
		const configReady = new Promise<void>((resolve) => {
			releaseConfig = resolve;
		});
		const loadConfig = async () => {
			configCalls += 1;
			if (configCalls === 1) {
				configStarted();
				await configReady;
			}
			return config({ "/configured": "Merge TD" });
		};
		extension(h.pi, { loadConfig });
		const sessionStart = h.handlers.get("session_start");
		expect(sessionStart).toBeDefined();
		if (!sessionStart)
			throw new Error("session_start handler was not registered");

		const staleStart = sessionStart(
			{ type: "session_start", reason: "startup" },
			h.ctx,
		);
		await configStartedSignal;
		const currentStart = sessionStart(
			{ type: "session_start", reason: "new" },
			h.ctx,
		);
		await currentStart;
		releaseConfig();
		await staleStart;

		expect(
			h.tools.filter((tool) => tool.name === "pi_todoist_gate_state"),
		).toHaveLength(1);
	});

	it("does not run Todoist hooks before startup finishes", async () => {
		const h = harness("/configured/project", [
			{
				type: "message",
				message: {
					role: "assistant",
					content: "Claimed Todoist task https://app.todoist.com/app/task/42",
				},
			},
		]);
		let resolveProject!: (value: { id: string; name: string }) => void;
		const projectReady = new Promise<{ id: string; name: string }>(
			(resolve) => {
				resolveProject = resolve;
			},
		);
		const client = {
			resolveProject: async () => projectReady,
			claimTask: async () => ({
				id: "42",
				content: "Implement feature",
				webUrl: "https://app.todoist.com/app/task/42",
			}),
		} as unknown as TodoistClient;
		const todoist = createTodoistModule(
			h.pi,
			{ codingRoot: "/configured", todoistProjectRef: "Merge TD" },
			{ projects: { "/configured": "Merge TD" } },
			{
				createTodoistClient: () => client,
				exec: projectExec,
				claimTaskWorker: async () => ({ status: "none" as const }),
			},
		);
		const startup = todoist.sessionStart({}, h.ctx);
		let beforeSettled = false;
		const beforeStartup = todoist.beforeAgentStart("continue").then(() => {
			beforeSettled = true;
		});
		await beforeStartup;
		expect(beforeSettled).toBe(true);
		resolveProject({ id: "project-1", name: "Merge TD" });
		await startup;

		expect(h.tools.map((tool) => tool.name)).toContain("pi_todoist_gate_state");
	});

	it("does not return Todoist context after deactivation during inference", async () => {
		const h = harness("/configured/project");
		let resolveProject!: (value: { id: string; name: string }) => void;
		const projectReady = new Promise<{ id: string; name: string }>(
			(resolve) => {
				resolveProject = resolve;
			},
		);
		const client = {
			resolveProject: async () => projectReady,
			claimTask: async () => ({
				id: "42",
				content: "Implement feature",
				webUrl: "https://app.todoist.com/app/task/42",
			}),
		} as unknown as TodoistClient;
		const todoist = createTodoistModule(
			h.pi,
			{ codingRoot: "/configured", todoistProjectRef: "Merge TD" },
			{ projects: { "/configured": "Merge TD" } },
			{ createTodoistClient: () => client },
		);
		await todoist.sessionStart({}, h.ctx);
		const pendingContext = todoist.beforeAgentStart(
			"Claimed Todoist task https://app.todoist.com/app/task/42",
		);
		await Promise.resolve();
		todoist.deactivate();
		resolveProject({ id: "project-1", name: "Merge TD" });

		await expect(pendingContext).resolves.toBe("");
	});

	it("does not infer Todoist state after inheriting an explicit clear", async () => {
		const root = "/configured/project";
		const h = harness(root, [
			{
				type: "message",
				message: {
					role: "assistant",
					content: "Claimed Todoist task https://app.todoist.com/app/task/42",
				},
			},
		]);
		const client = {
			resolveProject: async () => ({ id: "project-1", name: "Merge TD" }),
			claimTask: async () => ({
				id: "42",
				content: "Stale task",
				webUrl: "https://app.todoist.com/app/task/42",
			}),
		} as unknown as TodoistClient;
		const exec = async (command: string, args: string[]) => {
			if (command === "git" && args[0] === "rev-parse")
				return { stdout: root, stderr: "", code: 0 };
			if (command === "git" && args[0] === "branch")
				return { stdout: "feature", stderr: "", code: 0 };
			if (command === "git" && args[0] === "worktree")
				return { stdout: "worktree /main", stderr: "", code: 0 };
			return { stdout: "", stderr: "unavailable", code: 1 };
		};
		extension(h.pi, {
			loadConfig: async () => config({ "/configured": "Merge TD" }),
			exec,
			createTodoistClient: () => client,
			openSession: () => ({
				getBranch: () => [
					{
						type: "custom",
						customType: "pi-todoist-gate-state",
						data: {},
					},
				],
				getCwd: () => root,
			}),
		});
		await h.handlers.get("session_start")?.(
			{ type: "session_start", reason: "new", previousSessionFile: "previous" },
			h.ctx,
		);
		const result = await h.handlers.get("before_agent_start")?.(
			{ type: "before_agent_start", prompt: "continue" },
			h.ctx,
		);

		expect(contextContent(result)).toBe("");
		expect(h.appended).toHaveLength(0);
	});

	it("does not inherit an unresolved PR link", async () => {
		const h = harness("/repo");
		const exec = async (command: string, args: string[]) => {
			if (command === "git" && args[0] === "rev-parse")
				return { stdout: "/repo\\n", stderr: "", code: 0 };
			if (command === "git" && args[0] === "branch")
				return { stdout: "feature\\n", stderr: "", code: 0 };
			if (command === "git" && args[0] === "worktree")
				return { stdout: "worktree /main\\n", stderr: "", code: 0 };
			return { stdout: "", stderr: "not found", code: 1 };
		};
		extension(h.pi, {
			loadConfig: async () => config({}),
			exec,
			openSession: () => ({
				getCwd: () => "/repo",
				getBranch: () => [
					{
						type: "custom",
						customType: "pi-pr-gate-state",
						data: { prUrl: "https://github.com/o/r/pull/42" },
					},
				],
			}),
		});
		await h.handlers.get("session_start")?.(
			{ type: "session_start", reason: "new", previousSessionFile: "previous" },
			h.ctx,
		);

		expect(h.appended).toHaveLength(0);
	});

	it("does not inherit PR state after explicit clear", async () => {
		const h = harness("/repo", [
			{
				type: "custom",
				customType: "pi-pr-gate-state",
				data: { discoveryDisabled: true },
			},
		]);
		const exec = async (command: string, args: string[]) => {
			if (command === "git" && args[0] === "rev-parse")
				return { stdout: "/repo\\n", stderr: "", code: 0 };
			if (command === "git" && args[0] === "branch")
				return { stdout: "feature\\n", stderr: "", code: 0 };
			if (command === "git" && args[0] === "worktree")
				return { stdout: "worktree /main\\n", stderr: "", code: 0 };
			return { stdout: "", stderr: "not found", code: 1 };
		};
		extension(h.pi, {
			loadConfig: async () => config({}),
			exec,
			openSession: () => ({
				getCwd: () => "/repo",
				getBranch: () => [
					{
						type: "custom",
						customType: "pi-pr-gate-state",
						data: { prUrl: "https://github.com/o/r/pull/42" },
					},
				],
			}),
		});
		await h.handlers.get("session_start")?.(
			{ type: "session_start", reason: "new", previousSessionFile: "previous" },
			h.ctx,
		);

		expect(h.appended).toHaveLength(0);
	});

	it("resets work-change guidance when session changes", async () => {
		const h = harness("/repo");
		const exec = async (command: string, args: string[]) => {
			if (command === "git" && args[0] === "rev-parse")
				return { stdout: "/repo\\n", stderr: "", code: 0 };
			if (command === "git" && args[0] === "branch")
				return { stdout: "feature\\n", stderr: "", code: 0 };
			if (command === "git" && args[0] === "worktree")
				return { stdout: "worktree /main\\n", stderr: "", code: 0 };
			if (command === "gh") return { stdout: "[]", stderr: "", code: 0 };
			return { stdout: "", stderr: "", code: 1 };
		};
		await start(h, {}, { exec });
		await h.handlers.get("tool_result")?.(
			{
				type: "tool_result",
				toolName: "edit",
				isError: false,
			},
			h.ctx,
		);
		const beforeReset = await h.handlers.get("before_agent_start")?.(
			{ type: "before_agent_start", prompt: "continue" },
			h.ctx,
		);
		expect(contextContent(beforeReset)).toContain(
			"When implementation is finished, push this branch and create a GitHub PR.",
		);

		await h.handlers.get("session_start")?.(
			{ type: "session_start", reason: "new" },
			h.ctx,
		);
		const afterReset = await h.handlers.get("before_agent_start")?.(
			{ type: "before_agent_start", prompt: "continue" },
			h.ctx,
		);
		expect(contextContent(afterReset)).not.toContain(
			"When implementation is finished, push this branch and create a GitHub PR.",
		);
	});

	it("deactivates Todoist before new session initialization awaits", async () => {
		const h = harness("/configured/project");
		let holdConfig = false;
		let configStarted!: () => void;
		let releaseConfig!: () => void;
		const configStartedSignal = new Promise<void>((resolve) => {
			configStarted = resolve;
		});
		const configReady = new Promise<void>((resolve) => {
			releaseConfig = resolve;
		});
		let resolveClaim!: (value: {
			id: string;
			content: string;
			webUrl: string;
		}) => void;
		const claim = new Promise<{
			id: string;
			content: string;
			webUrl: string;
		}>((resolve) => {
			resolveClaim = resolve;
		});
		const client = {
			resolveProject: async () => ({ id: "project-1", name: "Merge TD" }),
			claimTask: async () => claim,
		};
		const loadConfig = async () => {
			if (holdConfig) {
				configStarted();
				await configReady;
			}
			return config({ "/configured": "Merge TD" });
		};
		await start(
			h,
			{ "/configured": "Merge TD" },
			{ loadConfig, createTodoistClient: () => client },
		);
		const todoistTool = h.tools.find(
			(tool) => tool.name === "pi_todoist_gate_state",
		);
		expect(todoistTool).toBeDefined();
		if (!todoistTool) throw new Error("Todoist tool was not registered");
		const pendingClaim = todoistTool.execute(
			"call",
			{ action: "set_task", task: "42" },
			undefined,
			undefined,
			h.ctx,
		);
		holdConfig = true;
		const pendingStart = h.handlers.get("session_start")?.(
			{ type: "session_start", reason: "new" },
			h.ctx,
		);
		await configStartedSignal;
		resolveClaim({
			id: "42",
			content: "Implement feature",
			webUrl: "https://app.todoist.com/app/task/42",
		});
		await pendingClaim;
		expect(h.appended).toHaveLength(0);
		// Release new session config after stale operation has been invalidated.
		releaseConfig();
		await pendingStart;
	});

	it("quiesces old PR state while a new session initializes", async () => {
		const h = harness("/repo");
		let switching = false;
		let releaseGit!: () => void;
		let gitStarted!: () => void;
		const gitReady = new Promise<void>((resolve) => {
			gitStarted = resolve;
		});
		const blockedGit = new Promise<void>((resolve) => {
			releaseGit = resolve;
		});
		const exec = async (command: string) => {
			if (switching && command === "git") {
				gitStarted();
				await blockedGit;
			}
			if (command === "gh")
				return switching
					? {
							stdout: '{"state":"MERGED","mergedAt":"now"}',
							stderr: "",
							code: 0,
						}
					: { stdout: '{"state":"OPEN","mergedAt":""}', stderr: "", code: 0 };
			return { stdout: "", stderr: "", code: 1 };
		};
		await start(h, {}, { exec });
		const prTool = h.tools.find((tool) => tool.name === "pi_pr_gate_state");
		expect(prTool).toBeDefined();
		if (!prTool) throw new Error("PR tool was not registered");
		await prTool.execute(
			"call",
			{ action: "set_pr", url: "https://github.com/o/r/pull/42" },
			undefined,
			undefined,
			h.ctx,
		);
		const appendCount = h.appended.length;
		switching = true;
		const pendingStart = h.handlers.get("session_start")?.(
			{ type: "session_start", reason: "new" },
			h.ctx,
		);
		await gitReady;
		const beforeReset = await h.handlers.get("before_agent_start")?.(
			{ type: "before_agent_start", prompt: "continue" },
			h.ctx,
		);
		expect(contextContent(beforeReset)).toBe("");
		expect(h.appended).toHaveLength(appendCount);
		releaseGit();
		await pendingStart;
	});
});

describe("independent state tools", () => {
	it("sets Todoist task through Todoist tool only", async () => {
		const h = harness("/configured/project");
		const client = {
			resolveProject: async () => ({ id: "project-1", name: "Merge TD" }),
			claimTask: async (ref: string) => ({
				id: ref,
				content: "Implement feature",
				webUrl: `https://app.todoist.com/app/task/${ref}`,
				projectId: "project-1",
			}),
		} as unknown as TodoistClient;
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
		expect(todoistTool).toBeDefined();
		if (!todoistTool) throw new Error("Todoist tool was not registered");
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
