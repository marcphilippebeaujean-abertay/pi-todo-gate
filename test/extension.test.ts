import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import extension from "../extensions/pi-todo-gate.ts";
import type { ExitAction } from "../src/exit-protocol/types.ts";
import type {
	CommandRunner as HerdrCommandRunner,
	StartBackgroundWorker,
} from "../src/herdr-claim-gate.ts";
import { createSharedEvents } from "../src/shared/events.ts";
import type { TodoistClient } from "../src/todoist/client.ts";
import { createTodoistModule } from "../src/todoist/module.ts";

type Handler = (event: unknown, ctx: unknown) => unknown;
type TestTool = {
	name: string;
	execute(...args: unknown[]): Promise<unknown>;
};
type CommandHandler = (args: string, ctx: unknown) => Promise<void>;

function harness(cwd: string, branch: unknown[] = []) {
	const handlers = new Map<string, Handler>();
	const commands = new Map<string, CommandHandler>();
	const tools: TestTool[] = [];
	const appended: unknown[] = [];
	const notifications: string[] = [];
	const statusCalls: Array<{ key: string; text: string | undefined }> = [];
	let activeTools: string[] = [];
	const pi = {
		on: (event: string, handler: Handler) => {
			const previous = handlers.get(event);
			if (!previous) {
				handlers.set(event, handler);
				return;
			}
			handlers.set(event, async (eventValue, contextValue) => {
				await previous(eventValue, contextValue);
				return handler(eventValue, contextValue);
			});
		},
		registerTool: (tool: TestTool) => tools.push(tool),
		registerCommand: (name: string, options: { handler: CommandHandler }) =>
			commands.set(name, options.handler),
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
			select: async () => "Yes",
			setStatus: (key: string, text: string | undefined) =>
				statusCalls.push({ key, text }),
		},
		sessionManager: {
			getBranch: () => branch,
			getSessionId: () => "session-current",
			getCwd: () => cwd,
		},
	} as unknown as ExtensionContext;
	return {
		pi,
		ctx,
		handlers,
		commands,
		tools,
		appended,
		notifications,
		statusCalls,
	};
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

	it("does not register behavior for any subagent marker value", () => {
		const h = harness("/project");
		const previous = process.env.PI_SUBAGENT_CHILD;
		process.env.PI_SUBAGENT_CHILD = "0";
		try {
			extension(h.pi, { loadConfig: async () => config({}) });
		} finally {
			if (previous === undefined) delete process.env.PI_SUBAGENT_CHILD;
			else process.env.PI_SUBAGENT_CHILD = previous;
		}
		expect(h.handlers.size).toBe(0);
		expect(h.tools).toHaveLength(0);
	});

	it("runs Herdr worker globally while Todoist stays project-scoped", async () => {
		const h = harness("/unconfigured/project");
		const workerStart: StartBackgroundWorker = vi.fn(() => ({
			cancel: () => undefined,
		}));
		const herdrRunner: HerdrCommandRunner = () => "{}";
		const previousHerdr = process.env.HERDR_ENV;
		const previousSubagent = process.env.PI_SUBAGENT_CHILD;
		process.env.HERDR_ENV = "1";
		delete process.env.PI_SUBAGENT_CHILD;
		try {
			extension(h.pi, {
				loadConfig: async () => config({ "/configured": "merge-td" }),
				exec: projectExec,
				claimTaskWorker: async () => ({ status: "none" as const }),
				herdrCommandRunner: herdrRunner,
				herdrStartBackgroundWorker: workerStart,
			});
			await h.handlers.get("session_start")?.(
				{ type: "session_start", reason: "startup" },
				h.ctx,
			);
			const result = await h.handlers.get("before_agent_start")?.(
				{ prompt: "Fix Herdr worker" },
				h.ctx,
			);
			expect(workerStart).toHaveBeenCalledOnce();
			expect(contextContent(result)).not.toContain("STEP 0 — Setup Herdr");
		} finally {
			if (previousHerdr === undefined) delete process.env.HERDR_ENV;
			else process.env.HERDR_ENV = previousHerdr;
			if (previousSubagent === undefined) delete process.env.PI_SUBAGENT_CHILD;
			else process.env.PI_SUBAGENT_CHILD = previousSubagent;
		}
		expect(h.tools.map((tool) => tool.name)).toEqual(["pi_pr_gate_state"]);
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
			"pi_todoist_gate_state",
			"pi_pr_gate_state",
		]);
		expect(h.statusCalls.map(({ key }) => key)).toEqual([
			"pi-todo-gate-task",
			"pi-todo-gate-pr",
		]);
		const todoistTool = h.tools.find(
			(tool) => tool.name === "pi_todoist_gate_state",
		);
		const actionValues = (
			todoistTool as unknown as {
				parameters: { properties: { action: { enum: string[] } } };
			}
		).parameters.properties.action.enum;
		expect(actionValues).toEqual(["status"]);
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
		const h = harness("/configured/.worktrees/project", [
			{
				type: "message",
				message: { role: "user", content: "initial request" },
			},
		]);
		const inputs: unknown[] = [];
		const todoist = createTodoistModule(
			h.pi,
			{
				codingRoot: "/configured",
				todoistProjectRef: "Pi Extensions",
			},
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
		await vi.waitFor(() => expect(inputs).toHaveLength(1));

		expect(inputs).toHaveLength(1);
		expect(inputs[0]).toMatchObject({
			prompt: "Implement feature",
			cwd: "/configured/.worktrees/project",
			projectRef: "Pi Extensions",
			worktree: { isWorktree: true, branch: "feature" },
		});
		expect(inputs[0]).not.toHaveProperty("history");
	});

	it("shows pinned spinner and final no-update feedback", async () => {
		const h = harness("/configured/project");
		const worker = vi.fn(async () => ({ status: "none" as const }));
		const todoist = createTodoistModule(
			h.pi,
			{
				codingRoot: "/configured",
				todoistProjectRef: "Pi Extensions",
				triggersOnlyOnWorktree: false,
			},
			{ projects: { "/configured": "Pi Extensions" } },
			{ exec: projectExec, claimTaskWorker: worker },
		);
		await todoist.sessionStart({}, h.ctx);

		await h.commands.get("todoist-reevaluate")?.("", h.ctx);

		expect(h.statusCalls.some(({ text }) => text?.includes("⠋"))).toBe(true);
		expect(
			h.statusCalls.some(({ text }) =>
				text?.includes("Todoist Task: ⠋ evaluating |"),
			),
		).toBe(true);
		expect(h.notifications).toContain("No task update");
	});

	it("prompts to claim or skip an already in-progress task", async () => {
		const h = harness("/configured/project");
		const select = vi.fn(async () => "Claim");
		(h.ctx as unknown as { ui: { select: typeof select } }).ui.select = select;
		const claimTask = vi.fn(async () => ({
			id: "42",
			content: "Implement feature",
			webUrl: "https://app.todoist.com/app/task/42",
			projectId: "project-1",
			sectionName: "In Progress",
		}));
		const client = {
			resolveProject: async () => ({ id: "project-1", name: "Pi Extensions" }),
			claimTask,
		} as unknown as TodoistClient;
		const todoist = createTodoistModule(
			h.pi,
			{
				codingRoot: "/configured",
				todoistProjectRef: "Pi Extensions",
				triggersOnlyOnWorktree: false,
			},
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

		await todoist.beforeAgentStart("claim the detected task");
		await vi.waitFor(() => expect(h.appended.at(-1)).toBeDefined());

		expect(select).toHaveBeenCalledWith("Todoist task already in progress", [
			"Claim",
			"Skip",
		]);
		expect(claimTask).toHaveBeenCalledWith("42", {
			id: "project-1",
			allowInProgress: true,
		});
		expect(h.notifications).toContain("New task claimed");
	});

	it("skips an already in-progress task without taking it over", async () => {
		const h = harness("/configured/project");
		const select = vi.fn(async () => "Skip");
		(h.ctx as unknown as { ui: { select: typeof select } }).ui.select = select;
		const claimTask = vi.fn();
		const client = {
			resolveProject: async () => ({ id: "project-1", name: "Pi Extensions" }),
			claimTask,
		} as unknown as TodoistClient;
		const todoist = createTodoistModule(
			h.pi,
			{
				codingRoot: "/configured",
				todoistProjectRef: "Pi Extensions",
				triggersOnlyOnWorktree: false,
			},
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

		await todoist.beforeAgentStart("skip the detected task");
		await vi.waitFor(() => expect(select).toHaveBeenCalled());

		expect(claimTask).not.toHaveBeenCalled();
		expect(h.notifications).toContain("No task update");
	});

	it("reports evaluation failure details", async () => {
		const h = harness("/configured/project");
		let rejectWorker: (error: Error) => void = () => {};
		const worker = vi.fn(
			() =>
				new Promise<never>((_, reject) => {
					rejectWorker = reject;
				}),
		);
		const todoist = createTodoistModule(
			h.pi,
			{
				codingRoot: "/configured",
				todoistProjectRef: "Pi Extensions",
				triggersOnlyOnWorktree: false,
			},
			{ projects: { "/configured": "Pi Extensions" } },
			{ exec: projectExec, claimTaskWorker: worker },
		);
		await todoist.sessionStart({}, h.ctx);

		await expect(todoist.beforeAgentStart("Implement feature")).resolves.toBe(
			"",
		);
		await vi.waitFor(() => expect(worker).toHaveBeenCalled());
		rejectWorker(new Error("interrupted"));
		await vi.waitFor(() =>
			expect(h.notifications).toContain(
				"Todoist task evaluation failed: interrupted",
			),
		);
	});

	it("skips automatic evaluation on repository root by default", async () => {
		const h = harness("/configured");
		const worker = vi.fn(async () => ({ status: "none" as const }));
		const rootExec = async (command: string, args: string[]) => {
			const key = [command, ...args].join(" ");
			if (key === "git rev-parse --show-toplevel")
				return { stdout: "/configured\n", stderr: "", code: 0 };
			if (key === "git branch --show-current")
				return { stdout: "main\n", stderr: "", code: 0 };
			if (key === "git worktree list --porcelain")
				return {
					stdout: "worktree /configured\nHEAD abc\nbranch refs/heads/main\n",
					stderr: "",
					code: 0,
				};
			return { stdout: "", stderr: "", code: 0 };
		};
		const todoist = createTodoistModule(
			h.pi,
			{
				codingRoot: "/configured",
				todoistProjectRef: "Pi Extensions",
				triggersOnlyOnWorktree: true,
			},
			{ projects: { "/configured": "Pi Extensions" } },
			{ exec: rootExec, claimTaskWorker: worker },
		);
		await todoist.sessionStart({}, h.ctx);
		await todoist.beforeAgentStart("Implement feature");
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(worker).not.toHaveBeenCalled();
	});

	it("reports a newly claimed task after explicit reevaluation", async () => {
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
			{
				codingRoot: "/configured",
				todoistProjectRef: "Pi Extensions",
				triggersOnlyOnWorktree: false,
			},
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

		await h.commands.get("todoist-reevaluate")?.("focus now", h.ctx);

		expect(h.notifications).toContain("New task claimed");
	});

	it("re-evaluates task on explicit command", async () => {
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
		const worker = vi
			.fn()
			.mockResolvedValueOnce({ status: "none" as const })
			.mockResolvedValueOnce({ status: "claimed" as const, taskRef: "42" });
		const todoist = createTodoistModule(
			h.pi,
			{
				codingRoot: "/configured",
				todoistProjectRef: "Pi Extensions",
				triggersOnlyOnWorktree: false,
			},
			{ projects: { "/configured": "Pi Extensions" } },
			{
				exec: projectExec,
				createTodoistClient: () => client,
				claimTaskWorker: worker,
			},
		);
		await todoist.sessionStart({}, h.ctx);
		await todoist.beforeAgentStart("initial");
		await vi.waitFor(() => expect(worker).toHaveBeenCalledTimes(1));

		const command = h.commands.get("todoist-reevaluate");
		expect(command).toBeDefined();
		await command?.("focus now", h.ctx);

		expect(worker).toHaveBeenCalledTimes(2);
		expect(worker.mock.calls[1][0]).toMatchObject({ prompt: "focus now" });
		expect(h.appended.at(-1)).toMatchObject({ data: { taskRef: "42" } });
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
			{
				codingRoot: "/configured",
				todoistProjectRef: "Pi Extensions",
				triggersOnlyOnWorktree: false,
			},
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
		await vi.waitFor(() => expect(h.appended.at(-1)).toBeDefined());
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
		const select = vi.fn(async () => "Claim");
		(h.ctx as unknown as { ui: { select: typeof select } }).ui.select = select;
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
			{
				codingRoot: "/configured",
				todoistProjectRef: "Pi Extensions",
				triggersOnlyOnWorktree: false,
			},
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
		await vi.waitFor(() => expect(select).toHaveBeenCalled());

		expect(select).toHaveBeenCalledWith("Todoist task already in progress", [
			"Claim",
			"Skip",
		]);
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
	it("clears task fields after successful merge completion", async () => {
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
		const completeTask = vi.fn(async () => {});
		const client = { completeTask } as unknown as TodoistClient;
		const events = createSharedEvents();
		const todoist = createTodoistModule(
			h.pi,
			{
				codingRoot: "/configured",
				todoistProjectRef: "Pi Extensions",
				triggersOnlyOnWorktree: false,
			},
			{ projects: { "/configured": "Pi Extensions" } },
			{ createTodoistClient: () => client, events },
		);
		events.on(
			"prMerged",
			async (request) => {
				for (const action of request.actions) await action.execute();
			},
			"present",
		);
		await todoist.sessionStart({}, h.ctx);

		await events.emit("prMerged", {
			prUrl: "https://github.com/o/r/pull/42",
		});

		expect(completeTask).toHaveBeenCalledWith("42");
		expect(h.appended.at(-1)).toEqual({
			type: "pi-todoist-gate-state",
			data: {
				mergePromptedPrUrl: "https://github.com/o/r/pull/42",
			},
		});
		expect(h.statusCalls.at(-1)).toEqual({
			key: "pi-todo-gate-task",
			text: "Todoist Task: none |",
		});
	});

	it("notifies after marking merged task complete", async () => {
		const h = harness("/configured/project", [
			{
				type: "custom",
				customType: "pi-todoist-gate-state",
				data: { taskRef: "42", taskName: "Implement feature" },
			},
		]);
		const completeTask = vi.fn(async () => {});
		const client = { completeTask } as unknown as TodoistClient;
		const events = createSharedEvents();
		const todoist = createTodoistModule(
			h.pi,
			{
				codingRoot: "/configured",
				todoistProjectRef: "Pi Extensions",
				triggersOnlyOnWorktree: false,
			},
			{ projects: { "/configured": "Pi Extensions" } },
			{ createTodoistClient: () => client, events },
		);
		events.on(
			"prMerged",
			async (request) => {
				for (const action of request.actions) await action.execute();
			},
			"present",
		);
		await todoist.sessionStart({}, h.ctx);

		await events.emit("prMerged", {
			prUrl: "https://github.com/o/r/pull/42",
		});

		expect(completeTask).toHaveBeenCalledWith("42");
		expect(h.notifications).toContain("Task marked as complete");
	});

	it("finishes captured Todoist task without clearing newer session state", async () => {
		const first = harness("/configured/project", [
			{
				type: "custom",
				customType: "pi-todoist-gate-state",
				data: { taskRef: "old", taskName: "Old task" },
			},
		]);
		const second = harness("/configured/project", [
			{
				type: "custom",
				customType: "pi-todoist-gate-state",
				data: { taskRef: "new", taskName: "New task" },
			},
		]);
		let releaseCompletion: (() => void) | undefined;
		const completionStarted = new Promise<void>((resolve) => {
			releaseCompletion = resolve;
		});
		const completeTask = vi.fn(async () => completionStarted);
		const events = createSharedEvents();
		const todoist = createTodoistModule(
			first.pi,
			{
				codingRoot: "/configured",
				todoistProjectRef: "Pi Extensions",
				triggersOnlyOnWorktree: false,
			},
			{ projects: { "/configured": "Pi Extensions" } },
			{
				createTodoistClient: () =>
					({ completeTask }) as unknown as TodoistClient,
				events,
			},
		);
		await todoist.sessionStart({}, first.ctx);
		let action: ExitAction | undefined;
		events.on(
			"prMerged",
			(request) => {
				action = request.actions[0];
			},
			"present",
		);
		await events.emit("prMerged", { prUrl: "https://github.com/o/r/pull/42" });
		const execution = action?.execute();
		await vi.waitFor(() => expect(completeTask).toHaveBeenCalledWith("old"));
		await todoist.sessionStart({}, second.ctx);
		releaseCompletion?.();
		expect(await execution).toBe("completed");
		expect(second.appended.at(-1)).not.toEqual({
			type: "pi-todoist-gate-state",
			data: {},
		});
	});

	it("offers active task on quit through shared events", async () => {
		const h = harness("/configured/project", [
			{
				type: "custom",
				customType: "pi-todoist-gate-state",
				data: { taskRef: "42", taskName: "Implement feature" },
			},
		]);
		const events = createSharedEvents();
		const todoist = createTodoistModule(
			h.pi,
			{
				codingRoot: "/configured",
				todoistProjectRef: "Pi Extensions",
				triggersOnlyOnWorktree: false,
			},
			{ projects: { "/configured": "Pi Extensions" } },
			{ createTodoistClient: () => ({}) as TodoistClient, events },
		);
		await todoist.sessionStart({}, h.ctx);
		let action: string | undefined;
		events.on(
			"sessionWillClose",
			(request) => {
				action = request.actions[0]?.label;
			},
			"present",
		);
		await events.emit("sessionWillClose", { reason: "quit" });
		expect(action).toBe('Mark Todoist task "Implement feature" complete');
	});

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

	it("publishes merged PR through shared events", async () => {
		const h = harness("/configured/project", [
			{
				type: "custom",
				customType: "pi-pr-gate-state",
				data: { prUrl: "https://github.com/o/r/pull/42" },
			},
		]);
		const events = createSharedEvents();
		const merged = vi.fn();
		events.on("prMerged", (request) => merged(request.payload.prUrl));
		const exec = async (command: string, args: string[]) => {
			if (command === "gh")
				return {
					stdout: JSON.stringify({ state: "MERGED", mergedAt: "now" }),
					stderr: "",
					code: 0,
				};
			return projectExec(command, args);
		};
		await start(h, {}, { exec, events });
		expect(merged).toHaveBeenCalledWith("https://github.com/o/r/pull/42");
	});

	it("completes Todoist task from merged PR event", async () => {
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
		const events = createSharedEvents();
		const merged = vi.fn();
		events.on("prMerged", (request) => {
			merged(request.payload.prUrl);
		});
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
				events,
			},
		);
		expect(completions).toBe(1);
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
