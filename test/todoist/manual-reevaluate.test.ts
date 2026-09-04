import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import type { FooterUpdate } from "../../src/footer/types.ts";
import { createTodoistModule } from "../../src/todoist/module.ts";

type CommandHandler = (args: string, ctx: unknown) => Promise<void>;

function harness(cwd: string) {
	const commands = new Map<string, CommandHandler>();
	const statusCalls: Array<{ key: string; text: string | undefined }> = [];
	const footerEvents: FooterUpdate[] = [];
	const pi = {
		registerCommand: (name: string, options: { handler: CommandHandler }) =>
			commands.set(name, options.handler),
		registerTool: () => {},
		appendEntry: () => {},
	} as unknown as ExtensionAPI;
	const ctx = {
		cwd,
		hasUI: true,
		ui: {
			theme: { fg: (_color: string, text: string) => text },
			notify: () => {},
			confirm: async () => true,
			setStatus: (key: string, text: string | undefined) =>
				statusCalls.push({ key, text }),
		},
		sessionManager: {
			getBranch: () => [],
		},
	} as unknown as ExtensionContext;
	return { commands, ctx, pi, statusCalls, footerEvents };
}

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

describe("manual Todoist reevaluation", () => {
	it("keeps main checkout task none until explicit reevaluation", async () => {
		const h = harness("/configured");
		const worker = vi.fn(async () => ({ status: "none" as const }));
		const todoist = createTodoistModule(
			h.pi,
			{
				codingRoot: "/configured",
				todoistProjectRef: "Pi Extensions",
				triggersOnlyOnWorktree: true,
			},
			{ projects: { "/configured": "Pi Extensions" } },
			{
				exec: rootExec,
				claimTaskWorker: worker,
				onFooterUpdate: (event) => {
					h.footerEvents.push(event);
					h.statusCalls.push({
						key: event.footerType,
						text: event.isVisible ? event.text : undefined,
					});
				},
			},
		);

		await todoist.sessionStart({}, h.ctx);
		expect(h.statusCalls.at(-1)).toEqual({
			key: "pi-todo-gate-task",
			text: "Todoist Task: none |",
		});

		await todoist.beforeAgentStart("initial");
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(worker).not.toHaveBeenCalled();

		await h.commands.get("todoist-reevaluate")?.("focus now", h.ctx);

		expect(worker).toHaveBeenCalledWith(
			expect.objectContaining({ prompt: "focus now" }),
		);
	});
});
