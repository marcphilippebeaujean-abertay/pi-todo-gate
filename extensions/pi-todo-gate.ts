import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { createPrModule, type PrModuleDependencies } from "../src/pr/module.ts";
import type { Exec } from "../src/shared/command.ts";
import type { TodoistClient } from "../src/todoist/client.ts";
import type { TodoistProjectMapping } from "../src/todoist/config.ts";
import { loadConfig, resolveConfiguredProject } from "../src/todoist/config.ts";
import {
	createTodoistModule,
	type TodoistModule,
	type TodoistModuleDependencies,
} from "../src/todoist/module.ts";

export interface ExtensionDependencies {
	loadConfig?: () => Promise<TodoistProjectMapping>;
	openSession?: (path: string) => {
		getBranch(): unknown[];
		getCwd(): string;
	};
	exec?: Exec;
	createTodoistClient?: (ctx: ExtensionContext, exec: Exec) => TodoistClient;
}

function textOf(value: unknown): string {
	if (typeof value === "string") return value;
	if (Array.isArray(value))
		return value
			.map((part) =>
				typeof part === "object" && part !== null && "text" in part
					? String(part.text)
					: "",
			)
			.join(" ");
	if (typeof value === "object" && value !== null && "content" in value)
		return textOf((value as { content?: unknown }).content);
	return "";
}

function updateActiveTools(pi: ExtensionAPI, todoistActive: boolean): void {
	if (!pi.getActiveTools || !pi.setActiveTools) return;
	const tools = pi
		.getActiveTools()
		.filter(
			(name) => name !== "pi_pr_gate_state" && name !== "pi_todoist_gate_state",
		);
	tools.push("pi_pr_gate_state");
	if (todoistActive) tools.push("pi_todoist_gate_state");
	pi.setActiveTools(tools);
}

async function forwardSafely(
	ctx: ExtensionContext,
	label: string,
	action: () => Promise<void>,
): Promise<void> {
	try {
		await action();
	} catch {
		ctx.ui.notify(`${label} tracking is unavailable`, "warning");
	}
}

export default function extension(
	pi: ExtensionAPI,
	dependencies: ExtensionDependencies = {},
): void {
	if (process.env.PI_SUBAGENT_CHILD === "1") return;

	const prDependencies: PrModuleDependencies = {
		openSession: dependencies.openSession,
		exec: dependencies.exec,
	};
	const todoistDependencies: TodoistModuleDependencies = {
		openSession: dependencies.openSession,
		exec: dependencies.exec,
		createTodoistClient: dependencies.createTodoistClient,
	};
	const pr = createPrModule(pi, prDependencies);
	let todoist: TodoistModule | null = null;

	pi.on("session_start", async (event, ctx) => {
		await forwardSafely(ctx, "PR", () => pr.sessionStart(event, ctx));

		const config = await (dependencies.loadConfig ?? loadConfig)();
		const project = resolveConfiguredProject(ctx.cwd, config);
		if (todoist) {
			todoist.deactivate();
			todoist = null;
		}
		if (project) {
			todoist = createTodoistModule(pi, project, config, todoistDependencies);
			await forwardSafely(
				ctx,
				"Todoist",
				() => todoist?.sessionStart(event, ctx) ?? Promise.resolve(),
			);
		}
		updateActiveTools(pi, todoist !== null);
	});

	pi.on("message_end", async (event, ctx) => {
		await forwardSafely(ctx, "PR", async () => {
			await pr.messageEnd(textOf(event.message));
		});
	});

	pi.on("before_agent_start", async (event, ctx) => {
		const messages: string[] = [];
		await forwardSafely(ctx, "PR", async () => {
			messages.push(...(await pr.beforeAgentStart()));
		});
		if (todoist)
			await forwardSafely(ctx, "Todoist", async () => {
				messages.push(
					(await todoist?.beforeAgentStart(event.prompt ?? "")) ?? "",
				);
			});
		const content = messages.filter(Boolean).join("\n");
		return content
			? {
					message: {
						customType: "pi-todo-gate-context",
						content,
						display: false,
					},
				}
			: undefined;
	});

	pi.on("tool_result", async (event, ctx) => {
		const input = {
			toolName: String(event.toolName),
			command:
				typeof event.input?.command === "string"
					? event.input.command
					: undefined,
			content: event.content,
			isError: event.isError,
		};
		await forwardSafely(ctx, "PR", () => pr.toolResult(input));
		if (todoist)
			await forwardSafely(
				ctx,
				"Todoist",
				() => todoist?.toolResult(input) ?? Promise.resolve(),
			);
	});

	pi.on("session_shutdown", async () => {
		pr.deactivate();
		todoist?.deactivate();
		todoist = null;
	});
}
