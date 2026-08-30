import { StringEnum } from "@earendil-works/pi-ai";
import {
	type ExtensionAPI,
	type ExtensionContext,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { type Exec, spawnExec } from "../shared/command.ts";
import { inspectProject } from "../shared/project.ts";
import {
	appendCustomState,
	latestCustomState,
} from "../shared/session-state.ts";
import { createTaskClaimWorker, type TaskClaimWorker } from "./claim-worker.ts";
import { TodoistClient } from "./client.ts";
import {
	type ResolvedProject,
	resolveConfiguredProject,
	type TodoistProjectMapping,
} from "./config.ts";
import { renderTaskStatus } from "./footer.ts";
import {
	applyTodoistStatePatch,
	isTodoistState,
	TODOIST_STATE_TYPE,
	type TodoistState,
} from "./state.ts";

export interface TodoistSessionReader {
	getBranch(): unknown[];
	getCwd(): string;
}

export interface TodoistModuleDependencies {
	loadConfig?: () => Promise<TodoistProjectMapping>;
	openSession?: (path: string) => TodoistSessionReader;
	exec?: Exec;
	createTodoistClient?: (ctx: ExtensionContext, exec: Exec) => TodoistClient;
	claimTaskWorker?: TaskClaimWorker;
}

export interface TodoistModule {
	reconfigure(project: ResolvedProject, config: TodoistProjectMapping): void;
	sessionStart(
		event: { previousSessionFile?: string },
		ctx: ExtensionContext,
	): Promise<void>;
	beforeAgentStart(prompt: string): Promise<string>;
	toolResult(input: {
		toolName: string;
		command?: string;
		content?: unknown;
		isError: boolean;
	}): Promise<void>;
	deactivate(): void;
}

const stateParameters = Type.Object({
	action: StringEnum(["status", "set_task", "clear_task"] as const),
	task: Type.Optional(Type.String()),
});

type StateAction =
	| { action: "status" }
	| { action: "set_task"; task?: string }
	| { action: "clear_task" };

type SessionContext = Pick<
	ExtensionContext,
	"cwd" | "ui" | "sessionManager" | "hasUI"
>;

function branchTexts(entries: readonly unknown[]): string[] {
	return entries
		.filter(
			(entry) =>
				typeof entry === "object" &&
				entry !== null &&
				(entry as { type?: unknown }).type !== "custom",
		)
		.map((entry) => JSON.stringify(entry));
}

function extensionResult(text: string): {
	content: [{ type: "text"; text: string }];
	details: undefined;
} {
	return { content: [{ type: "text", text }], details: undefined };
}

function createClient(
	ctx: ExtensionContext,
	dependencies: TodoistModuleDependencies,
): TodoistClient {
	const exec = dependencies.exec ?? spawnExec;
	return (
		dependencies.createTodoistClient?.(ctx, exec) ??
		new TodoistClient({
			run: (args) => exec("td", [...args], { cwd: ctx.cwd }),
		})
	);
}

export function createTodoistModule(
	pi: ExtensionAPI,
	project: ResolvedProject,
	config: TodoistProjectMapping,
	dependencies: TodoistModuleDependencies = {},
): TodoistModule {
	let activeProject = project;
	let activeConfig = config;
	let context: SessionContext | null = null;
	let state: TodoistState = {};
	let registered = false;
	let operationGeneration = 0;
	let ready = false;
	let claimAnalysisComplete = false;

	const refreshStatus = (): void => {
		if (!context) return;
		context.ui.setStatus(
			"pi-todo-gate-task",
			renderTaskStatus(state.taskUrl, context.ui.theme, state.taskName),
		);
	};

	const appendState = (): void => {
		appendCustomState(
			(type, data) => pi.appendEntry(type, data),
			TODOIST_STATE_TYPE,
			state,
		);
	};

	const persistClaimedTask = async (
		taskRef: string,
		generation: number,
	): Promise<void> => {
		if (!context || generation !== operationGeneration) return;
		const client = createClient(context as ExtensionContext, dependencies);
		const resolved = await client.resolveProject(
			activeProject.todoistProjectRef,
		);
		if (generation !== operationGeneration || !context) return;
		const claimed = await client.claimTask(taskRef, {
			id: resolved.id,
			allowInProgress: true,
		});
		if (generation !== operationGeneration || !context) return;
		state = applyTodoistStatePatch(state, {
			taskRef: claimed.id,
			taskName: claimed.content,
			taskUrl:
				claimed.webUrl ??
				claimed.url ??
				`https://app.todoist.com/app/task/${claimed.id}`,
		});
		appendState();
		refreshStatus();
	};

	const analyzeTaskClaim = async (prompt: string): Promise<void> => {
		if (!context || claimAnalysisComplete || state.taskRef) return;
		claimAnalysisComplete = true;
		const generation = ++operationGeneration;
		try {
			const worker =
				dependencies.claimTaskWorker ??
				createTaskClaimWorker(dependencies.exec ?? spawnExec);
			const worktree = await inspectProject(
				dependencies.exec ?? spawnExec,
				context.cwd,
			);
			if (generation !== operationGeneration || !context) return;
			const result = await worker({
				prompt,
				history: branchTexts(context.sessionManager.getBranch()),
				cwd: context.cwd,
				projectRef: activeProject.todoistProjectRef,
				worktree,
			});
			if (generation !== operationGeneration || !context) return;
			if (result.status === "none") return;
			if (result.status === "collision") {
				if (!context.hasUI) return;
				const taskName = result.taskName ? `\nTask: ${result.taskName}` : "";
				const accepted = await context.ui.confirm(
					"Todoist task collision",
					`Detected task is already In Progress.${taskName}\n\nSwitch to this task?`,
				);
				if (!accepted || generation !== operationGeneration) return;
			}
			await persistClaimedTask(result.taskRef, generation);
		} catch {
			// Claim handling is isolated from the main agent and non-fatal.
		}
	};

	const registerTool = (): void => {
		if (registered) return;
		registered = true;
		pi.registerTool<typeof stateParameters>({
			name: "pi_todoist_gate_state",
			label: "Todoist Gate State",
			description: "Inspect or change this session's claimed Todoist task.",
			promptSnippet: "inspect or update the session Todoist task",
			parameters: stateParameters,
			async execute(_toolCallId, params: StateAction, _signal, _onUpdate, ctx) {
				if (!context) throw new Error("Todoist tracking is inactive");
				if (!ready) throw new Error("Todoist tracking is initializing");
				if (params.action === "status")
					return extensionResult(
						JSON.stringify({ ...state, codingRoot: activeProject.codingRoot }),
					);
				if (params.action === "set_task") {
					if (!params.task)
						throw new Error("set_task requires a Todoist task reference");
					const generation = ++operationGeneration;
					try {
						const client = createClient(ctx, dependencies);
						const resolved = await client.resolveProject(
							activeProject.todoistProjectRef,
						);
						if (generation !== operationGeneration)
							return extensionResult("Todoist task change superseded");
						const claimed = await client.claimTask(params.task, {
							id: resolved.id,
							currentTaskId: state.taskRef,
						});
						if (generation !== operationGeneration)
							return extensionResult("Todoist task change superseded");
						state = applyTodoistStatePatch(state, {
							taskRef: claimed.id,
							taskName: claimed.content,
							taskUrl: claimed.webUrl ?? claimed.url,
						});
						claimAnalysisComplete = true;
						appendState();
						refreshStatus();
						return extensionResult(
							`Claimed Todoist task ${claimed.webUrl ?? claimed.url ?? claimed.id}`,
						);
					} catch (error) {
						if (generation !== operationGeneration)
							return extensionResult("Todoist task change superseded");
						throw error;
					}
				}
				++operationGeneration;
				claimAnalysisComplete = true;
				state = {};
				appendState();
				refreshStatus();
				return extensionResult("Cleared the claimed Todoist task");
			},
		});
	};

	return {
		reconfigure(nextProject, nextConfig) {
			++operationGeneration;
			ready = false;
			activeProject = nextProject;
			activeConfig = nextConfig;
			state = {};
			claimAnalysisComplete = false;
		},
		async sessionStart(event, nextContext) {
			const generation = ++operationGeneration;
			ready = false;
			context = nextContext;
			const currentState = latestCustomState(
				nextContext.sessionManager.getBranch(),
				TODOIST_STATE_TYPE,
				isTodoistState,
			);
			claimAnalysisComplete = currentState !== null;
			state = currentState ?? {};
			if (!currentState && event.previousSessionFile) {
				const previous =
					dependencies.openSession?.(event.previousSessionFile) ??
					SessionManager.open(event.previousSessionFile);
				const previousProject = resolveConfiguredProject(
					previous.getCwd(),
					activeConfig,
				);
				if (previousProject?.codingRoot === activeProject.codingRoot) {
					const inherited = latestCustomState(
						previous.getBranch(),
						TODOIST_STATE_TYPE,
						isTodoistState,
					);
					if (inherited) {
						state = inherited;
						claimAnalysisComplete = true;
						if (state.taskRef) appendState();
					}
				}
			}
			registerTool();
			refreshStatus();
			if (generation === operationGeneration) ready = true;
		},
		async beforeAgentStart(prompt) {
			if (!context || !ready) return "";
			await analyzeTaskClaim(prompt);
			return "";
		},
		async toolResult(_input) {
			// Task claims are analyzed once before the first main-agent turn.
		},
		deactivate() {
			++operationGeneration;
			ready = false;
			claimAnalysisComplete = true;
			if (context) context.ui.setStatus("pi-todo-gate-task", undefined);
			context = null;
			state = {};
		},
	};
}
