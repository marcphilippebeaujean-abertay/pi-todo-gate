const STRING_LITERAL_WORKTREES_8285263A = ".worktrees";
const STRING_LITERAL_ALREADY_IN_PROGRESS_C31DEAF5 = "already in progress";
const STRING_LITERAL_1_REDACTED_44C829DF = "$1[redacted]";
const STRING_LITERAL_1_REDACTED_ACC791CD = "$1=[redacted]";
const STRING_LITERAL_TEXT_DB0B2528 = "text";
const STRING_LITERAL_TD_4CF244E2 = "td";
const STRING_LITERAL_TODOIST_TASK_ALREADY_IN_PROGRESS_70123C90 =
	"Todoist task already in progress";
const STRING_LITERAL_CLAIM_229AC561 = "Claim";
const STRING_LITERAL_SKIP_822166F6 = "Skip";
const STRING_LITERAL_PI_TODO_GATE_TASK_628F81BD = "pi-todo-gate-task";
const STRING_LITERAL_TODOIST_TASK_EVALUATING_2B6416BD =
	"Todoist Task: ⠋ evaluating |";
const STRING_LITERAL_NONE_DD96B7D5 = "none";
const STRING_LITERAL_CLAIMED_1FF9791D = "claimed";
const STRING_LITERAL_WARNING_1AF27964 = "warning";
const STRING_LITERAL_NEW_TASK_CLAIMED_54B0BE98 = "New task claimed";
const STRING_LITERAL_NO_TASK_UPDATE_BAAD7610 = "No task update";
const STRING_LITERAL_INFO_528F4BDE = "info";
const STRING_LITERAL_TODOIST_REEVALUATE_4762D96C = "todoist-reevaluate";
const STRING_LITERAL_RE_EVALUATE_THE_TODOIST_TASK_6EE57F6D =
	"Re-evaluate the Todoist task for current work.";
const STRING_LITERAL_PI_TODOIST_GATE_STATE_52D21E83 = "pi_todoist_gate_state";
const STRING_LITERAL_TODOIST_GATE_STATE_D2B5EEB0 = "Todoist Gate State";
const STRING_LITERAL_INSPECT_OR_CHANGE_THIS_SESSION_286F36BF =
	"Inspect or change this session's claimed Todoist task.";
const STRING_LITERAL_INSPECT_OR_UPDATE_THE_SESSION_272A7F47 =
	"inspect or update the session Todoist task";
const STRING_LITERAL_TODOIST_TRACKING_IS_INACTIVE_4C509D7A =
	"Todoist tracking is inactive";
const STRING_LITERAL_TODOIST_TRACKING_IS_INITIALIZING_12E62CE4 =
	"Todoist tracking is initializing";
const STRING_LITERAL_SET_TASK_REQUIRES_A_TODOIST_AE02E229 =
	"set_task requires a Todoist task reference";
const STRING_LITERAL_TODOIST_TASK_CLAIMING_C033FA83 =
	"Todoist Task: ⠋ claiming |";
const STRING_LITERAL_TODOIST_TASK_CHANGE_SUPERSEDED_CEF83986 =
	"Todoist task change superseded";
const STRING_LITERAL_CLEARED_THE_CLAIMED_TODOIST_TASK_E32EE960 =
	"Cleared the claimed Todoist task";
const STRING_LITERAL_YES_244E9008 = "Yes";
const STRING_LITERAL_NO_1F8C7B8A = "No";
const STRING_LITERAL_NO_AND_CLEAR_SESSION_TASK_23474660 =
	"No and clear session task";
const STRING_LITERAL_TODOIST_TASK_COMPLETING_BE7E006C =
	"Todoist Task: ⠋ completing |";
const STRING_LITERAL_TASK_MARKED_AS_COMPLETE_53EFF7BF =
	"Task marked as complete";

import { StringEnum } from "@earendil-works/pi-ai";
import {
	type ExtensionAPI,
	type ExtensionContext,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { type Exec, spawnExec } from "../shared/command.ts";
import type { MergeEvent } from "../shared/merge-detection.ts";
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
	mergeDetected(event: MergeEvent): Promise<void>;
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
	return cwd.split(/[\\/]/).includes(STRING_LITERAL_WORKTREES_8285263A);
}

function isTaskAlreadyInProgress(error: unknown): boolean {
	return (
		error instanceof TodoistError &&
		error.message
			.toLowerCase()
			.includes(STRING_LITERAL_ALREADY_IN_PROGRESS_C31DEAF5)
	);
}

function displayError(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return message
		.replace(
			/(authorization\s*[:=]\s*bearer\s+)[^\s,;]+/gi,
			STRING_LITERAL_1_REDACTED_44C829DF,
		)
		.replace(/(bearer\s+)[^\s,;]+/gi, STRING_LITERAL_1_REDACTED_44C829DF)
		.replace(
			/(token|password|secret)\s*[:=]?\s*[^\s,;]+/gi,
			STRING_LITERAL_1_REDACTED_ACC791CD,
		)
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 300);
}

function extensionResult(text: string): {
	content: [{ type: "text"; text: string }];
	details: undefined;
} {
	return {
		content: [{ type: STRING_LITERAL_TEXT_DB0B2528, text }],
		details: undefined,
	};
}

function createClient(
	ctx: ExtensionContext,
	dependencies: TodoistModuleDependencies,
): TodoistClient {
	const exec = dependencies.exec ?? spawnExec;
	return (
		dependencies.createTodoistClient?.(ctx, exec) ??
		new TodoistClient({
			run: (args) =>
				exec(STRING_LITERAL_TD_4CF244E2, [...args], { cwd: ctx.cwd }),
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
			STRING_LITERAL_TODOIST_TASK_ALREADY_IN_PROGRESS_70123C90,
			[STRING_LITERAL_CLAIM_229AC561, STRING_LITERAL_SKIP_822166F6],
		);
		return choice === STRING_LITERAL_CLAIM_229AC561;
	};

	const refreshStatus = (): void => {
		if (!context) return;
		context.ui.setStatus(
			STRING_LITERAL_PI_TODO_GATE_TASK_628F81BD,
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
			STRING_LITERAL_PI_TODO_GATE_TASK_628F81BD,
			STRING_LITERAL_TODOIST_TASK_EVALUATING_2B6416BD,
		);
		let feedback: "none" | "claimed" = STRING_LITERAL_NONE_DD96B7D5;
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
				const shouldSkipCollision =
					!(await promptToClaimInProgressTask(runContext));
				if (shouldSkipCollision) return;
				if (generation !== operationGeneration) return;
			}
			await persistClaimedTask(result.taskRef, generation);
			feedback = STRING_LITERAL_CLAIMED_1FF9791D;
		} catch (error) {
			failure = error;
		} finally {
			const isCurrentOperation =
				generation === operationGeneration && context === runContext;
			if (isCurrentOperation) {
				refreshStatus();
				if (runContext.hasUI) {
					const hasFailure = failure !== undefined;
					if (hasFailure)
						runContext.ui.notify(
							`Todoist task evaluation failed: ${displayError(failure)}`,
							STRING_LITERAL_WARNING_1AF27964,
						);
					else
						runContext.ui.notify(
							feedback === STRING_LITERAL_CLAIMED_1FF9791D
								? STRING_LITERAL_NEW_TASK_CLAIMED_54B0BE98
								: STRING_LITERAL_NO_TASK_UPDATE_BAAD7610,
							STRING_LITERAL_INFO_528F4BDE,
						);
				}
			}
		}
	};

	const registerTool = (): void => {
		if (registered) return;
		registered = true;
		pi.registerCommand(STRING_LITERAL_TODOIST_REEVALUATE_4762D96C, {
			description: STRING_LITERAL_RE_EVALUATE_THE_TODOIST_TASK_6EE57F6D,
			handler: async (args) => {
				if (!context || !ready) return;
				await analyzeTaskClaim(
					args.trim() || STRING_LITERAL_RE_EVALUATE_THE_TODOIST_TASK_6EE57F6D,
					true,
				);
			},
		});
		pi.registerTool<typeof stateParameters>({
			name: STRING_LITERAL_PI_TODOIST_GATE_STATE_52D21E83,
			label: STRING_LITERAL_TODOIST_GATE_STATE_D2B5EEB0,
			description: STRING_LITERAL_INSPECT_OR_CHANGE_THIS_SESSION_286F36BF,
			promptSnippet: STRING_LITERAL_INSPECT_OR_UPDATE_THE_SESSION_272A7F47,
			parameters: stateParameters,
			async execute(_toolCallId, params: StateAction, _signal, _onUpdate, ctx) {
				if (!context)
					throw new Error(STRING_LITERAL_TODOIST_TRACKING_IS_INACTIVE_4C509D7A);
				if (!ready)
					throw new Error(
						STRING_LITERAL_TODOIST_TRACKING_IS_INITIALIZING_12E62CE4,
					);
				if (params.action === "status")
					return extensionResult(
						JSON.stringify({ ...state, codingRoot: activeProject.codingRoot }),
					);
				if (params.action === "set_task") {
					if (!params.task)
						throw new Error(
							STRING_LITERAL_SET_TASK_REQUIRES_A_TODOIST_AE02E229,
						);
					const generation = ++operationGeneration;
					const runContext = context;
					runContext?.ui.setStatus(
						STRING_LITERAL_PI_TODO_GATE_TASK_628F81BD,
						STRING_LITERAL_TODOIST_TASK_CLAIMING_C033FA83,
					);
					try {
						const client = createClient(ctx, dependencies);
						const resolved = await client.resolveProject(
							activeProject.todoistProjectRef,
						);
						if (generation !== operationGeneration)
							return extensionResult(
								STRING_LITERAL_TODOIST_TASK_CHANGE_SUPERSEDED_CEF83986,
							);
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
								runContext.ui.notify(
									STRING_LITERAL_NO_TASK_UPDATE_BAAD7610,
									STRING_LITERAL_INFO_528F4BDE,
								);
								return extensionResult(STRING_LITERAL_NO_TASK_UPDATE_BAAD7610);
							}
							if (generation !== operationGeneration || context !== runContext)
								return extensionResult(
									STRING_LITERAL_TODOIST_TASK_CHANGE_SUPERSEDED_CEF83986,
								);
							claimed = await client.claimTask(params.task, {
								id: resolved.id,
								allowInProgress: true,
							});
						}
						if (generation !== operationGeneration)
							return extensionResult(
								STRING_LITERAL_TODOIST_TASK_CHANGE_SUPERSEDED_CEF83986,
							);
						state = applyTodoistStatePatch(state, {
							taskRef: claimed.id,
							taskName: claimed.content,
							taskUrl: claimed.webUrl ?? claimed.url,
							mergePromptedPrUrl: undefined,
						});
						claimAnalysisComplete = true;
						appendState();
						if (runContext?.hasUI)
							runContext.ui.notify(
								STRING_LITERAL_NEW_TASK_CLAIMED_54B0BE98,
								STRING_LITERAL_INFO_528F4BDE,
							);
						return extensionResult(
							`Claimed Todoist task ${claimed.webUrl ?? claimed.url ?? claimed.id}`,
						);
					} catch (error) {
						if (generation !== operationGeneration)
							return extensionResult(
								STRING_LITERAL_TODOIST_TASK_CHANGE_SUPERSEDED_CEF83986,
							);
						if (runContext?.hasUI)
							runContext.ui.notify(
								`Todoist task claim failed: ${displayError(error)}`,
								STRING_LITERAL_WARNING_1AF27964,
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
				return extensionResult(
					STRING_LITERAL_CLEARED_THE_CLAIMED_TODOIST_TASK_E32EE960,
				);
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
			void analyzeTaskClaim(prompt);
			return "";
		},
		async mergeDetected(event) {
			const runContext = context;
			if (
				!runContext ||
				!ready ||
				!runContext.hasUI ||
				!state.taskRef ||
				state.mergePromptedPrUrl === event.prUrl
			)
				return;
			const generation = operationGeneration;
			const taskRef = state.taskRef;
			const taskName = state.taskName ?? taskRef;
			state = applyTodoistStatePatch(state, {
				mergePromptedPrUrl: event.prUrl,
			});
			appendState();
			const choice = await runContext.ui.select(
				`Do you wish to mark task ${taskName} as complete?`,
				[
					STRING_LITERAL_YES_244E9008,
					STRING_LITERAL_NO_1F8C7B8A,
					STRING_LITERAL_NO_AND_CLEAR_SESSION_TASK_23474660,
				],
			);
			if (
				generation !== operationGeneration ||
				context !== runContext ||
				state.taskRef !== taskRef ||
				state.mergePromptedPrUrl !== event.prUrl
			)
				return;
			if (choice === STRING_LITERAL_NO_AND_CLEAR_SESSION_TASK_23474660) {
				++operationGeneration;
				claimAnalysisComplete = true;
				state = {};
				appendState();
				refreshStatus();
				return;
			}
			if (choice !== STRING_LITERAL_YES_244E9008) return;
			runContext.ui.setStatus(
				STRING_LITERAL_PI_TODO_GATE_TASK_628F81BD,
				STRING_LITERAL_TODOIST_TASK_COMPLETING_BE7E006C,
			);
			try {
				await createClient(
					runContext as ExtensionContext,
					dependencies,
				).completeTask(taskRef);
				if (generation !== operationGeneration || context !== runContext)
					return;
				state = applyTodoistStatePatch(state, {
					taskRef: undefined,
					taskName: undefined,
					taskUrl: undefined,
				});
				appendState();
				runContext.ui.notify(
					STRING_LITERAL_TASK_MARKED_AS_COMPLETE_53EFF7BF,
					STRING_LITERAL_INFO_528F4BDE,
				);
			} catch (error) {
				if (generation !== operationGeneration || context !== runContext)
					return;
				runContext.ui.notify(
					`Todoist task completion failed: ${displayError(error)}`,
					STRING_LITERAL_WARNING_1AF27964,
				);
			} finally {
				if (generation === operationGeneration && context === runContext)
					refreshStatus();
			}
		},
		async toolResult(_input) {
			// Task claims are analyzed once before the first main-agent turn.
		},
		deactivate() {
			++operationGeneration;
			ready = false;
			claimAnalysisComplete = true;
			if (context)
				context.ui.setStatus(
					STRING_LITERAL_PI_TODO_GATE_TASK_628F81BD,
					undefined,
				);
			context = null;
			state = {};
		},
	};
}
