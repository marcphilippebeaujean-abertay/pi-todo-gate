import { StringEnum } from "@earendil-works/pi-ai";
import {
	type ExtensionAPI,
	type ExtensionContext,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { ExitAction } from "../exit-protocol/types.ts";
import { type Exec, spawnExec } from "../shared/command.ts";
import type { SharedEvents } from "../shared/events.ts";
import { inspectProject } from "../shared/project.ts";
import {
	appendCustomState,
	latestCustomState,
} from "../shared/session-state.ts";
import { createTaskClaimWorker, type TaskClaimWorker } from "./claim-worker.ts";
import { TodoistClient, TodoistError, type TodoistTask } from "./client.ts";
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
	events?: SharedEvents;
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

function isWorktreePath(cwd: string): boolean {
	return cwd.split(/[\\/]/).includes(".worktrees");
}

function isTaskAlreadyInProgress(error: unknown): boolean {
	return (
		error instanceof TodoistError &&
		error.message.toLowerCase().includes("already in progress")
	);
}

function displayError(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return message
		.replace(/(authorization\s*[:=]\s*bearer\s+)[^\s,;]+/gi, "$1[redacted]")
		.replace(/(bearer\s+)[^\s,;]+/gi, "$1[redacted]")
		.replace(/(token|password|secret)\s*[:=]?\s*[^\s,;]+/gi, "$1=[redacted]")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 300);
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

	const promptToClaimInProgressTask = async (
		runContext: SessionContext,
	): Promise<boolean> => {
		if (!runContext.hasUI) return false;
		const choice = await runContext.ui.select(
			"Todoist task already in progress",
			["Claim", "Skip"],
		);
		return choice === "Claim";
	};

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
			mergePromptedPrUrl: undefined,
		});
		appendState();
		refreshStatus();
	};

	const analyzeTaskClaim = async (
		prompt: string,
		force = false,
	): Promise<void> => {
		const runContext = context;
		if (!runContext || (!force && (claimAnalysisComplete || state.taskRef)))
			return;
		claimAnalysisComplete = true;
		const generation = ++operationGeneration;
		runContext.ui.setStatus(
			"pi-todo-gate-task",
			"Todoist Task: ⠋ evaluating |",
		);
		let feedback: "none" | "claimed" = "none";
		let failure: unknown;
		try {
			if (
				!force &&
				activeProject.triggersOnlyOnWorktree !== false &&
				!isWorktreePath(runContext.cwd)
			)
				return;
			const worktree = await inspectProject(
				dependencies.exec ?? spawnExec,
				runContext.cwd,
			);
			if (generation !== operationGeneration || context !== runContext) return;
			const worker =
				dependencies.claimTaskWorker ??
				createTaskClaimWorker(dependencies.exec ?? spawnExec);
			const result = await worker({
				prompt,
				cwd: runContext.cwd,
				projectRef: activeProject.todoistProjectRef,
				worktree,
			});
			if (generation !== operationGeneration || context !== runContext) return;
			if (result.status === "none") return;
			if (result.status === "collision") {
				if (!(await promptToClaimInProgressTask(runContext))) return;
				if (generation !== operationGeneration) return;
			}
			await persistClaimedTask(result.taskRef, generation);
			feedback = "claimed";
		} catch (error) {
			failure = error;
		} finally {
			const isCurrentOperation =
				generation === operationGeneration && context === runContext;
			if (isCurrentOperation) {
				refreshStatus();
				if (runContext.hasUI) {
					if (failure)
						runContext.ui.notify(
							`Todoist task evaluation failed: ${displayError(failure)}`,
							"warning",
						);
					else
						runContext.ui.notify(
							feedback === "claimed" ? "New task claimed" : "No task update",
							"info",
						);
				}
			}
		}
	};

	const registerTool = (): void => {
		if (registered) return;
		registered = true;
		pi.registerCommand("todoist-reevaluate", {
			description: "Re-evaluate the Todoist task for current work.",
			handler: async (args) => {
				if (!context || !ready) return;
				await analyzeTaskClaim(
					args.trim() || "Re-evaluate the Todoist task for current work.",
					true,
				);
			},
		});
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
					const runContext = context;
					if (runContext)
						runContext.ui.setStatus(
							"pi-todo-gate-task",
							"Todoist Task: ⠋ claiming |",
						);
					try {
						const client = createClient(ctx, dependencies);
						const resolved = await client.resolveProject(
							activeProject.todoistProjectRef,
						);
						if (generation !== operationGeneration)
							return extensionResult("Todoist task change superseded");
						let claimed: TodoistTask;
						try {
							claimed = await client.claimTask(params.task, {
								id: resolved.id,
								currentTaskId: state.taskRef,
							});
						} catch (error) {
							if (!isTaskAlreadyInProgress(error) || !runContext) throw error;
							const shouldClaim = await promptToClaimInProgressTask(runContext);
							if (!shouldClaim) {
								runContext.ui.notify("No task update", "info");
								return extensionResult("No task update");
							}
							if (generation !== operationGeneration || context !== runContext)
								return extensionResult("Todoist task change superseded");
							claimed = await client.claimTask(params.task, {
								id: resolved.id,
								allowInProgress: true,
							});
						}
						if (generation !== operationGeneration)
							return extensionResult("Todoist task change superseded");
						state = applyTodoistStatePatch(state, {
							taskRef: claimed.id,
							taskName: claimed.content,
							taskUrl: claimed.webUrl ?? claimed.url,
							mergePromptedPrUrl: undefined,
						});
						claimAnalysisComplete = true;
						appendState();
						if (runContext?.hasUI)
							runContext.ui.notify("New task claimed", "info");
						return extensionResult(
							`Claimed Todoist task ${claimed.webUrl ?? claimed.url ?? claimed.id}`,
						);
					} catch (error) {
						if (generation !== operationGeneration)
							return extensionResult("Todoist task change superseded");
						if (runContext?.hasUI)
							runContext.ui.notify(
								`Todoist task claim failed: ${displayError(error)}`,
								"warning",
							);
						throw error;
					} finally {
						if (generation === operationGeneration && context === runContext)
							refreshStatus();
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

	const completionAction = (
		runContext: SessionContext,
		generation: number,
		taskRef: string,
		taskName: string,
	): ExitAction => ({
		id: "complete-todoist-task",
		label: `Mark Todoist task "${taskName}" complete`,
		execute: async () => {
			if (
				!context ||
				context !== runContext ||
				generation !== operationGeneration ||
				state.taskRef !== taskRef
			)
				return "failed";
			context.ui.setStatus("pi-todo-gate-task", "Todoist Task: ⠋ completing |");
			try {
				await createClient(
					runContext as ExtensionContext,
					dependencies,
				).completeTask(taskRef);
				if (
					generation !== operationGeneration ||
					context !== runContext ||
					state.taskRef !== taskRef
				)
					return "failed";
				state = applyTodoistStatePatch(state, {
					taskRef: undefined,
					taskName: undefined,
					taskUrl: undefined,
				});
				appendState();
				context.ui.notify("Task marked as complete", "info");
				return "completed";
			} catch (error) {
				if (generation !== operationGeneration || context !== runContext)
					return "failed";
				context.ui.notify(
					`Todoist task completion failed: ${displayError(error)}`,
					"warning",
				);
				return "failed";
			} finally {
				if (generation === operationGeneration && context === runContext)
					refreshStatus();
			}
		},
	});

	if (dependencies.events) {
		dependencies.events.on("prMerged", (request) => {
			const runContext = context;
			if (!runContext || !ready || !state.taskRef) return;
			if (state.mergePromptedPrUrl === request.payload.prUrl) return;
			const generation = operationGeneration;
			const taskRef = state.taskRef;
			const taskName = state.taskName ?? taskRef;
			state = applyTodoistStatePatch(state, {
				mergePromptedPrUrl: request.payload.prUrl,
			});
			appendState();
			request.addAction(
				completionAction(runContext, generation, taskRef, taskName),
			);
		});
	}

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
			void analyzeTaskClaim(prompt);
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
