const STRING_LITERAL_TEXT_B43F99C2 = "text";
const STRING_LITERAL_CONTENT_9FE9E88F = "content";
const STRING_LITERAL_PI_PR_GATE_STATE_D2314256 = "pi_pr_gate_state";
const STRING_LITERAL_PI_TODOIST_GATE_STATE_36883774 = "pi_todoist_gate_state";
const STRING_LITERAL_WARNING_1ACED0B1 = "warning";
const STRING_LITERAL_SESSION_START_20ABDE4D = "session_start";
const STRING_LITERAL_PR_F7013F3D = "PR";
const STRING_LITERAL_TODOIST_A1930A5E = "Todoist";
const STRING_LITERAL_MESSAGE_END_97E66E00 = "message_end";
const STRING_LITERAL_BEFORE_AGENT_START_27FBB385 = "before_agent_start";
const STRING_LITERAL_PI_TODO_GATE_CONTEXT_B8CBBD47 = "pi-todo-gate-context";
const STRING_LITERAL_TOOL_RESULT_24307985 = "tool_result";
const STRING_LITERAL_SESSION_SHUTDOWN_7197B88A = "session_shutdown";

import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	type CommandRunner as HerdrCommandRunner,
	installHerdrClaimGate,
	type StartBackgroundWorker,
} from "../src/herdr-claim-gate.ts";
import { createPrModule, type PrModuleDependencies } from "../src/pr/module.ts";
import type { Exec } from "../src/shared/command.ts";
import type { TaskClaimWorker } from "../src/todoist/claim-worker.ts";
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
	claimTaskWorker?: TaskClaimWorker;
	herdrCommandRunner?: HerdrCommandRunner;
	herdrStartBackgroundWorker?: StartBackgroundWorker;
}

function textOf(value: unknown): string {
	if (typeof value === "string") return value;
	if (Array.isArray(value))
		return value
			.map((part) =>
				typeof part === "object" &&
				part !== null &&
				STRING_LITERAL_TEXT_B43F99C2 in part
					? String(part.text)
					: "",
			)
			.join(" ");
	if (
		typeof value === "object" &&
		value !== null &&
		STRING_LITERAL_CONTENT_9FE9E88F in value
	)
		return textOf((value as { content?: unknown }).content);
	return "";
}

function updateActiveTools(pi: ExtensionAPI, todoistActive: boolean): void {
	if (!pi.getActiveTools || !pi.setActiveTools) return;
	const tools = pi
		.getActiveTools()
		.filter(
			(name) =>
				name !== STRING_LITERAL_PI_PR_GATE_STATE_D2314256 &&
				name !== STRING_LITERAL_PI_TODOIST_GATE_STATE_36883774,
		);
	tools.push(STRING_LITERAL_PI_PR_GATE_STATE_D2314256);
	if (todoistActive) tools.push(STRING_LITERAL_PI_TODOIST_GATE_STATE_36883774);
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
			ctx.ui.notify(
				`${label} tracking is unavailable`,
				STRING_LITERAL_WARNING_1ACED0B1,
			);
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

	const prDependencies: PrModuleDependencies = {
		openSession: dependencies.openSession,
		exec: dependencies.exec,
	};
	const todoistDependencies: TodoistModuleDependencies = {
		openSession: dependencies.openSession,
		exec: dependencies.exec,
		createTodoistClient: dependencies.createTodoistClient,
		claimTaskWorker: dependencies.claimTaskWorker,
	};
	const pr = createPrModule(pi, prDependencies);
	let todoist: TodoistModule | null = null;
	let todoistActive = false;
	let sessionGeneration = 0;

	pi.on(STRING_LITERAL_SESSION_START_20ABDE4D, async (event, ctx) => {
		const generation = ++sessionGeneration;
		if (todoist) {
			todoist.deactivate();
			todoistActive = false;
		}
		await forwardSafely(ctx, STRING_LITERAL_PR_F7013F3D, () =>
			pr.sessionStart(event, ctx),
		);
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
				STRING_LITERAL_TODOIST_A1930A5E,
				() => nextTodoist.sessionStart(event, ctx),
				false,
			);
			if (generation !== sessionGeneration) {
				if (todoist !== nextTodoist) nextTodoist.deactivate();
				return;
			}
		}
		updateActiveTools(pi, todoistActive);
	});

	pi.on(STRING_LITERAL_MESSAGE_END_97E66E00, async (event, ctx) => {
		await forwardSafely(ctx, STRING_LITERAL_PR_F7013F3D, async () => {
			await pr.messageEnd(textOf(event.message));
		});
	});

	pi.on(STRING_LITERAL_BEFORE_AGENT_START_27FBB385, async (event, ctx) => {
		const generation = sessionGeneration;
		const sessionTodoist = todoistActive ? todoist : null;
		const messages: string[] = [];
		await forwardSafely(ctx, STRING_LITERAL_PR_F7013F3D, async () => {
			messages.push(...(await pr.beforeAgentStart()));
		});
		if (generation !== sessionGeneration) return undefined;
		const mergeEvents = pr.drainMergeEvents();
		if (sessionTodoist)
			for (const mergeEvent of mergeEvents)
				await forwardSafely(ctx, STRING_LITERAL_TODOIST_A1930A5E, () =>
					sessionTodoist.mergeDetected(mergeEvent),
				);
		if (generation !== sessionGeneration) return undefined;
		if (sessionTodoist)
			await forwardSafely(
				ctx,
				STRING_LITERAL_TODOIST_A1930A5E,
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
						customType: STRING_LITERAL_PI_TODO_GATE_CONTEXT_B8CBBD47,
						content,
						display: false,
					},
				}
			: undefined;
	});

	pi.on(STRING_LITERAL_TOOL_RESULT_24307985, async (event, ctx) => {
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
		const mergeEvent = await forwardSafely(
			ctx,
			STRING_LITERAL_PR_F7013F3D,
			() => pr.toolResult(input),
		);
		if (generation !== sessionGeneration) return;
		if (sessionTodoist && mergeEvent)
			await forwardSafely(ctx, STRING_LITERAL_TODOIST_A1930A5E, () =>
				sessionTodoist.mergeDetected(mergeEvent),
			);
		if (generation !== sessionGeneration) return;
		if (sessionTodoist)
			await forwardSafely(
				ctx,
				STRING_LITERAL_TODOIST_A1930A5E,
				() => sessionTodoist.toolResult(input),
				false,
			);
	});

	pi.on(STRING_LITERAL_SESSION_SHUTDOWN_7197B88A, async () => {
		++sessionGeneration;
		pr.deactivate();
		todoist?.deactivate();
		todoistActive = false;
	});
}
