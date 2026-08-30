import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import extension from "../extensions/pi-todo-gate.ts";

function harness(cwd: string, branch: unknown[] = []) {
	const handlers = new Map<
		string,
		(event: any, ctx: any) => Promise<any> | any
	>();
	const appended: unknown[] = [];
	const statusCalls: unknown[] = [];
	const notifications: string[] = [];
	const ctx: any = {
		cwd,
		mode: "print",
		hasUI: false,
		ui: {
			theme: { fg: (_color: string, text: string) => text },
			notify: (message: string) => notifications.push(message),
			setFooter: () => {},
			setStatus: (key: string, text: string | undefined) =>
				statusCalls.push({ key, text }),
		},
		sessionManager: {
			getBranch: () => branch,
			getSessionId: () => "session-current",
		},
	};
	const pi: any = {
		on: (event: string, handler: any) => handlers.set(event, handler),
		appendEntry: (type: string, data: unknown) => appended.push({ type, data }),
		registerTool: () => {},
	};
	return { pi, ctx, handlers, appended, notifications, statusCalls };
}

const config = (projects: Record<string, string>) => ({ projects });
const gitExec = async (command: string, args: string[]) => {
	const key = [command, ...args].join(" ");
	if (key === "git rev-parse --show-toplevel")
		return { stdout: "/repo/.worktrees/feature\n", stderr: "", code: 0 };
	if (key === "git branch --show-current")
		return { stdout: "feature\n", stderr: "", code: 0 };
	if (key === "git worktree list --porcelain")
		return {
			stdout:
				"worktree /repo\nHEAD abc\nbranch refs/heads/main\n\nworktree /repo/.worktrees/feature\nHEAD def\nbranch refs/heads/feature\n",
			stderr: "",
			code: 0,
		};
	return { stdout: "", stderr: "", code: 0 };
};

describe("deferred task claiming", () => {
	it("runs worker once with first prompt, history, and worktree details", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-todo-gate-deferred-"));
		const h = harness(root, [
			{
				type: "message",
				message: { role: "user", content: "initial request" },
			},
		]);
		const inputs: any[] = [];
		extension(h.pi, {
			loadConfig: async () => config({ [root]: "merge-td" }),
			exec: gitExec,
			claimTaskWorker: async (input: any) => {
				inputs.push(input);
				return { status: "none" };
			},
		});
		await h.handlers.get("session_start")?.({ type: "session_start" }, h.ctx);

		const event = { type: "before_agent_start", prompt: "Implement feature" };
		await h.handlers.get("before_agent_start")?.(event, h.ctx);
		await h.handlers.get("before_agent_start")?.(
			{ ...event, prompt: "second prompt" },
			h.ctx,
		);

		expect(inputs).toHaveLength(1);
		expect(inputs[0]).toMatchObject({
			prompt: "Implement feature",
			history: [expect.stringContaining("initial request")],
			cwd: root,
			projectRef: "merge-td",
			worktree: { isWorktree: true, branch: "feature" },
		});
	});

	it("does not add Todoist context to main prompt", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-todo-gate-deferred-"));
		const h = harness(root);
		extension(h.pi, {
			loadConfig: async () => config({ [root]: "merge-td" }),
			exec: gitExec,
			claimTaskWorker: async () => ({ status: "none" }),
		});
		await h.handlers.get("session_start")?.({ type: "session_start" }, h.ctx);

		expect(
			await h.handlers.get("before_agent_start")?.(
				{ type: "before_agent_start", prompt: "work" },
				h.ctx,
			),
		).toBeUndefined();
	});

	it("skips worker and Todoist handoff after /new inherits task", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-todo-gate-deferred-"));
		const h = harness(root);
		const worker = vi.fn(async () => ({ status: "none" as const }));
		extension(h.pi, {
			loadConfig: async () => config({ [root]: "merge-td" }),
			exec: gitExec,
			claimTaskWorker: worker,
			openSession: () => ({
				getBranch: () => [
					{
						type: "custom",
						customType: "pi-todo-gate-state",
						data: {
							taskRef: "42",
							taskUrl: "https://app.todoist.com/app/task/42",
						},
					},
				],
				getSessionId: () => "previous",
				getCwd: () => root,
			}),
		});
		await h.handlers.get("session_start")?.(
			{
				type: "session_start",
				previousSessionFile: "/sessions/previous.jsonl",
			},
			h.ctx,
		);

		const result = await h.handlers.get("before_agent_start")?.(
			{ type: "before_agent_start", prompt: "continue" },
			h.ctx,
		);
		expect(worker).not.toHaveBeenCalled();
		expect(result).toBeUndefined();
	});

	it("asks before switching to colliding task", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-todo-gate-deferred-"));
		const h = harness(root);
		h.ctx.hasUI = true;
		h.ctx.ui.confirm = vi.fn(async () => true);
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
			exec: gitExec,
			createTodoistClient: () => client,
			claimTaskWorker: async () => ({
				status: "collision",
				taskRef: "42",
				taskName: "Implement feature",
			}),
		});
		await h.handlers.get("session_start")?.({ type: "session_start" }, h.ctx);
		await h.handlers.get("before_agent_start")?.(
			{ type: "before_agent_start", prompt: "claim task 42" },
			h.ctx,
		);

		expect(h.ctx.ui.confirm).toHaveBeenCalled();
		expect(h.appended.at(-1)).toEqual({
			type: "pi-todo-gate-state",
			data: {
				taskRef: "42",
				taskName: "Implement feature",
				taskUrl: "https://app.todoist.com/app/task/42",
			},
		});
	});
});
