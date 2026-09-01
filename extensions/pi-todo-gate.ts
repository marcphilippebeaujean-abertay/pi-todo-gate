import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { createExitProtocolModule } from "../src/exit-protocol/module.ts";
import {
	type CommandRunner as HerdrCommandRunner,
	installHerdrClaimGate,
	type StartBackgroundWorker,
} from "../src/herdr-claim-gate.ts";
import { createPrModule, type PrModuleDependencies } from "../src/pr/module.ts";
import type { Exec } from "../src/shared/command.ts";
import { createSharedEvents } from "../src/shared/events.ts";
import type { TaskClaimWorker } from "../src/todoist/claim-worker.ts";
import type { TodoistClient } from "../src/todoist/client.ts";
import type { TodoistProjectMapping } from "../src/todoist/config.ts";
import { loadConfig, resolveConfiguredProject } from "../src/todoist/config.ts";
import {
	createTodoistModule,
	type TodoistModule,
	type TodoistModuleDependencies,
} from "../src/todoist/module.ts";
import { createWorktreeModule } from "../src/worktree/module.ts";

export interface ExtensionDependencies {
	loadConfig?: () => Promise<TodoistProjectMapping>;
	openSession?: (path: string) => {
		getBranch(): unknown[];
		getCwd(): string;
	};
	exec?: Exec;
	createTodoistClient?: (ctx: ExtensionContext, exec: Exec) => TodoistClient;
	claimTaskWorker?: TaskClaimWorker;
	herdrCommandRunner?: HerdrCommandRunner;
	herdrStartBackgroundWorker?: StartBackgroundWorker;
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

async function forwardSafely<T>(
	ctx: ExtensionContext,
	label: string,
	action: () => Promise<T>,
	notifyOnError = true,
): Promise<T | undefined> {
	try {
		return await action();
	} catch {
		if (notifyOnError)
			ctx.ui.notify(`${label} tracking is unavailable`, "warning");
		return undefined;
	}
}

export default function extension(
	pi: ExtensionAPI,
	dependencies: ExtensionDependencies = {},
): void {
	const isInSubagentSession = process.env.PI_SUBAGENT_CHILD === "1";
	if (isInSubagentSession) return;

	installHerdrClaimGate(pi, {
		commandRunner: dependencies.herdrCommandRunner,
		startBackgroundWorker: dependencies.herdrStartBackgroundWorker,
	});

	const events = createSharedEvents();
	const worktree = createWorktreeModule(events, { exec: dependencies.exec });
	const exitProtocol = createExitProtocolModule(events);
	const prDependencies: PrModuleDependencies = {
		openSession: dependencies.openSession,
		exec: dependencies.exec,
	};
	const todoistDependencies: TodoistModuleDependencies = {
		openSession: dependencies.openSession,
		exec: dependencies.exec,
		createTodoistClient: dependencies.createTodoistClient,
		claimTaskWorker: dependencies.claimTaskWorker,
		events,
	};
	const pr = createPrModule(pi, prDependencies);
	let todoist: TodoistModule | null = null;
	let todoistActive = false;
	let sessionGeneration = 0;

	pi.on("session_start", async (event, ctx) => {
		const generation = ++sessionGeneration;
		pr.deactivate();
		if (todoist) {
			todoist.deactivate();
			todoistActive = false;
		}
		exitProtocol.sessionStart(ctx);
		await forwardSafely(ctx, "Worktree", () => worktree.sessionStart(ctx));
		await forwardSafely(ctx, "PR", () => pr.sessionStart(event, ctx));
		if (generation !== sessionGeneration) return;

		const config = await (dependencies.loadConfig ?? loadConfig)();
		if (generation !== sessionGeneration) return;
		const project = resolveConfiguredProject(ctx.cwd, config);
		if (project) {
			const nextTodoist =
				todoist ??
				createTodoistModule(pi, project, config, todoistDependencies);
			if (todoist) nextTodoist.reconfigure(project, config);
			todoist = nextTodoist;
			todoistActive = true;
			await forwardSafely(
				ctx,
				"Todoist",
				() => nextTodoist.sessionStart(event, ctx),
				false,
			);
			if (generation !== sessionGeneration) {
				if (todoist !== nextTodoist) nextTodoist.deactivate();
				return;
			}
		}
		for (const mergeEvent of pr.drainMergeEvents())
			await forwardSafely(ctx, "Exit protocol", () =>
				events.emit("prMerged", mergeEvent),
			);
		updateActiveTools(pi, todoistActive);
	});

	pi.on("message_end", async (event, ctx) => {
		await forwardSafely(ctx, "PR", async () => {
			await pr.messageEnd(textOf(event.message));
		});
	});

	pi.on("before_agent_start", async (event, ctx) => {
		const generation = sessionGeneration;
		const sessionTodoist = todoistActive ? todoist : null;
		const messages: string[] = [];
		await forwardSafely(ctx, "PR", async () => {
			messages.push(...(await pr.beforeAgentStart()));
		});
		if (generation !== sessionGeneration) return undefined;
		const mergeEvents = pr.drainMergeEvents();
		for (const mergeEvent of mergeEvents)
			await forwardSafely(ctx, "Exit protocol", () =>
				events.emit("prMerged", mergeEvent),
			);
		if (generation !== sessionGeneration) return undefined;
		if (sessionTodoist)
			await forwardSafely(
				ctx,
				"Todoist",
				async () => {
					messages.push(
						(await sessionTodoist.beforeAgentStart(event.prompt ?? "")) ?? "",
					);
				},
				false,
			);
		if (generation !== sessionGeneration) return undefined;
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
		const generation = sessionGeneration;
		const sessionTodoist = todoistActive ? todoist : null;
		const input = {
			toolName: String(event.toolName),
			command:
				typeof event.input?.command === "string"
					? event.input.command
					: undefined,
			content: event.content,
			isError: event.isError,
		};
		const mergeEvent = await forwardSafely(ctx, "PR", () =>
			pr.toolResult(input),
		);
		if (generation !== sessionGeneration) return;
		if (mergeEvent)
			await forwardSafely(ctx, "Exit protocol", () =>
				events.emit("prMerged", mergeEvent),
			);
		if (generation !== sessionGeneration) return;
		if (sessionTodoist)
			await forwardSafely(
				ctx,
				"Todoist",
				() => sessionTodoist.toolResult(input),
				false,
			);
	});

	pi.on("session_shutdown", async (event, ctx) => {
		++sessionGeneration;
		await forwardSafely(ctx, "Exit protocol", () =>
			events.emit("sessionWillClose", { reason: event.reason }),
		);
		pr.deactivate();
		todoist?.deactivate();
		worktree.deactivate();
		exitProtocol.deactivate();
		todoistActive = false;
	});
}
