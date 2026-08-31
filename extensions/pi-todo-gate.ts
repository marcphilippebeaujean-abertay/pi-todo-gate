const TEXT = "text";
const EMPTY_STRING = "";
const SPACE = " ";
const CONTENT = "content";
const CUSTOM = "custom";
const TD = "td";
const PI_TODO_GATE_PR = "pi-todo-gate-pr";
const PI_TODO_GATE_TASK = "pi-todo-gate-task";
const TODOIST_TASK_WAS_NOT_LINKED_FROM_SESSION =
	"Todoist task was not linked from session history";
const WARNING_VALUE = "warning";
const TODOIST_TASK_UPDATE_FAILED = "Todoist task update failed";
const PI_TODO_GATE_STATE = "pi_todo_gate_state";
const TODO_GATE_STATE = "Todo Gate State";
const INSPECT_OR_CHANGE_THIS_SESSION_S_PINNED =
	"Inspect or change this session's pinned GitHub PR and claimed Todoist task.";
const INSPECT_OR_UPDATE_THE_SESSION_PR_AND =
	"inspect or update the session PR and Todoist task";
const PI_TODO_GATE_IS_INACTIVE_FOR_THIS =
	"pi-todo-gate is inactive for this project";
const STATUS = "status";
const SET_PR = "set_pr";
const SET_PR_REQUIRES_A_VALID_GITHUB_PULL =
	"set_pr requires a valid GitHub pull request URL";
const CLEAR_PR = "clear_pr";
const CLEARED_THE_PINNED_PR = "Cleared the pinned PR";
const SET_TASK = "set_task";
const SET_TASK_REQUIRES_A_TODOIST_TASK_REFERENCE =
	"set_task requires a Todoist task reference";
const CLEAR_TASK = "clear_task";
const CLEARED_THE_CLAIMED_TODOIST_TASK = "Cleared the claimed Todoist task";
const CLEARED_SESSION_PR_AND_TASK_LINKS = "Cleared session PR and task links";
const SESSION_START = "session_start";
const TUI = "tui";
const TODOIST_TASK_RESTORE_FAILED = "Todoist task restore failed";
const MESSAGE_END = "message_end";
const BEFORE_AGENT_START = "before_agent_start";
const NONE = "none";
const UNKNOWN_VALUE = "unknown";
const GITHUB_PR_LOOKUP_UNAVAILABLE_VERIFY_GH_AUTHENTICATION =
	"GitHub PR lookup unavailable; verify gh authentication before creating the PR.";
const WHEN_IMPLEMENTATION_IS_FINISHED_PUSH_THIS_BRANCH =
	"When implementation is finished, push this branch and create a GitHub PR.";
const PI_TODO_GATE_CONTEXT = "pi-todo-gate-context";
const TEXT_2 = "\n";
const TOOL_RESULT = "tool_result";
const EDIT = "edit";
const WRITE = "write";
const BASH = "bash";
const MERGED_PR_DETECTED_TODOIST_TASK_COMPLETED =
	"Merged PR detected; Todoist task completed";
const INFO_VALUE = "info";
const MERGED_PR_DETECTED_BUT_TODOIST_TASK_COMPLETION =
	"Merged PR detected, but Todoist task completion failed";
const AGENT_SETTLED = "agent_settled";
const SESSION_SHUTDOWN = "session_shutdown";
const UNKNOWN_VALUE_2 = "UNKNOWN";

import { StringEnum } from "@earendil-works/pi-ai";
import {
	type ExtensionAPI,
	type ExtensionContext,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { loadConfig, resolveConfiguredProject } from "../src/config.ts";
import { renderPrStatus, renderTaskStatus } from "../src/footer.ts";
import {
	type Exec,
	findOpenPr,
	inspectWorktree,
	matchesPinnedPr,
	spawnExec,
} from "../src/git.ts";
import {
	readPiTaskStore,
	sessionTaskPath,
	syncPiTasksToTodoist,
	syncTodoistToPiTasks,
	writePiTaskStore,
} from "../src/pi-tasks-sync.ts";
import { firstGithubPrUrl, githubPrUrl } from "../src/pr-detection.ts";
import {
	applyStatePatch,
	extractInheritedState,
	latestState,
} from "../src/session-state.ts";
import { TodoistClient } from "../src/todoist.ts";
import type {
	ResolvedProject,
	TodoistProjectMapping,
	WorkState,
} from "../src/types.ts";

export type WorkStateAction =
	| { action: "status" }
	| { action: "set_pr"; url: string }
	| { action: "clear_pr" }
	| { action: "set_task"; task: string }
	| { action: "clear_task" }
	| { action: "clear_all" };

export interface ExtensionDependencies {
	loadConfig?: (path?: string) => Promise<TodoistProjectMapping>;
	openSession?: (path: string) => SessionReader;
	exec?: Exec;
	createTodoistClient?: (ctx: ExtensionContext, exec: Exec) => TodoistClient;
}

const STATE_TYPE = "pi-todo-gate-state";
const MISSING_TASK_WARNING = "you have no claimed a todoist task yet!";
const taskToolNames = new Set([
	"TaskCreate",
	"TaskUpdate",
	"TaskStop",
	"TaskExecute",
]);
const stateParameters = Type.Object({
	action: StringEnum([
		"status",
		"set_pr",
		"clear_pr",
		"set_task",
		"clear_task",
		"clear_all",
	] as const),
	url: Type.Optional(Type.String()),
	task: Type.Optional(Type.String()),
});
type SessionReader = {
	getBranch(): unknown[];
	getSessionId(): string;
	getCwd(): string;
};

interface ActiveSession {
	context: ExtensionContext;
	project: ResolvedProject;
	state: WorkState;
	allowPrDiscovery: boolean;
	handoffContext: boolean;
	workChanged: boolean;
	syncAvailable: boolean;
	syncGeneration: number;
	syncTimer?: ReturnType<typeof setTimeout>;
}

function textOf(value: unknown): string {
	if (typeof value === "string") return value;
	if (Array.isArray(value))
		return value
			.map((part) =>
				typeof part === "object" && part !== null && TEXT in part
					? String(part.text)
					: EMPTY_STRING,
			)
			.join(SPACE);
	if (typeof value === "object" && value !== null && CONTENT in value) {
		return textOf((value as { content?: unknown }).content);
	}
	return EMPTY_STRING;
}

function extensionResult(text: string): {
	content: [{ type: "text"; text: string }];
	details: undefined;
} {
	return {
		content: [{ type: TEXT, text }],
		details: undefined,
	};
}

function latestStateData(
	entries: readonly unknown[],
): Record<string, unknown> | null {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (typeof entry !== "object" || entry === null) continue;
		const candidate = entry as {
			type?: unknown;
			customType?: unknown;
			data?: unknown;
		};
		if (
			candidate.type === CUSTOM &&
			candidate.customType === STATE_TYPE &&
			typeof candidate.data === "object" &&
			candidate.data !== null
		) {
			return candidate.data as Record<string, unknown>;
		}
	}
	return null;
}

function branchTexts(entries: readonly unknown[]): string[] {
	return entries
		.filter(
			(entry) =>
				typeof entry === "object" &&
				entry !== null &&
				(entry as { type?: unknown }).type !== CUSTOM,
		)
		.map((entry) => JSON.stringify(entry));
}

const TODOIST_TASK_URL_RE =
	/https:\/\/app\.todoist\.com\/app\/task\/([A-Za-z0-9_-]+)/gi;
const TODOIST_TASK_ID_RE =
	/\b(?:todoist\s+)?task\s+id\s*[:#]?\s*`?([A-Za-z0-9_-]+)/gi;
const CLAIMED_TASK_ID_RE =
	/\b(?:todoist\s+)?task\s+(?:is\s+)?claimed\s*[:#]?\s*`?([A-Za-z0-9_-]+)/gi;
const TODOIST_MOVE_RE =
	/\btd\s+task\s+move\s+(?:"([^"]+)"|'([^']+)'|([^\s]+))(?=[\s\S]*?--section\s+(?:"In Progress"|'In Progress'|In Progress))/gi;
const CLAIMED_TASK_RE =
	/\b(?:claimed|claiming)\s+(?:a\s+)?(?:todoist\s+)?task\b|\b(?:todoist\s+)?task\s+(?:is\s+)?claimed\b|--section\s+(?:"In Progress"|'In Progress'|In Progress)/i;
const NEGATED_CLAIM_RE =
	/\b(?:no|not|never)\s+(?:[a-z]+\s+){0,2}claimed\s+(?:a\s+)?(?:todoist\s+)?task\b/i;

function addMatches(
	text: string,
	expression: RegExp,
	matches: Set<string>,
): void {
	expression.lastIndex = 0;
	for (
		let match = expression.exec(text);
		match;
		match = expression.exec(text)
	) {
		const value = match.slice(1).find((candidate) => candidate);
		if (value) matches.add(value);
	}
}

function inferClaimedTaskRef(
	entries: readonly unknown[],
	prompt = EMPTY_STRING,
): string | undefined {
	const texts = [...branchTexts(entries), prompt];
	const allTaskRefs = new Set<string>();
	let hasUnboundClaimEvidence = false;
	for (const text of texts) {
		const textTaskRefs = new Set<string>();
		addMatches(text, TODOIST_TASK_URL_RE, textTaskRefs);
		addMatches(text, TODOIST_TASK_ID_RE, textTaskRefs);
		addMatches(text, CLAIMED_TASK_ID_RE, textTaskRefs);
		addMatches(text, TODOIST_MOVE_RE, textTaskRefs);
		for (const taskRef of textTaskRefs) allTaskRefs.add(taskRef);

		const isPositiveClaim =
			CLAIMED_TASK_RE.test(text) && !NEGATED_CLAIM_RE.test(text);
		if (!isPositiveClaim) continue;
		const associatedTaskRef = textTaskRefs.values().next().value;
		if (associatedTaskRef) return associatedTaskRef;
		hasUnboundClaimEvidence = true;
	}
	return hasUnboundClaimEvidence
		? allTaskRefs.values().next().value
		: undefined;
}

function createClient(
	ctx: ExtensionContext,
	dependencies: ExtensionDependencies,
): TodoistClient {
	const exec = dependencies.exec ?? spawnExec;
	return (
		dependencies.createTodoistClient?.(ctx, exec) ??
		new TodoistClient({
			run: (args) => exec(TD, [...args], { cwd: ctx.cwd }),
		})
	);
}

function appendState(
	pi: ExtensionAPI,
	state: WorkState,
	prDiscoveryDisabled = false,
): void {
	const data = prDiscoveryDisabled
		? { ...state, prDiscoveryDisabled: true }
		: state;
	pi.appendEntry(STATE_TYPE, data);
}

function taskPath(active: ActiveSession): string {
	return sessionTaskPath(
		active.context.cwd,
		active.context.sessionManager.getSessionId(),
	);
}

export default function extension(
	pi: ExtensionAPI,
	dependencies: ExtensionDependencies = {},
): void {
	let active: ActiveSession | null = null;
	let registered = false;

	const persistPrIfAvailable = (text: string): void => {
		if (!active?.allowPrDiscovery || active.state.prUrl) return;
		const url = githubPrUrl(text);
		if (!url) return;
		active.state = applyStatePatch(active.state, { prUrl: url });
		active.allowPrDiscovery = false;
		appendState(pi, active.state);
		refreshFooterStatuses(active);
	};

	const clearLocalTasks = async (session: ActiveSession): Promise<void> => {
		await writePiTaskStore(taskPath(session), { nextId: 1, tasks: [] });
	};

	const cancelScheduledSync = (session: ActiveSession): void => {
		session.syncGeneration += 1;
		if (session.syncTimer) {
			clearTimeout(session.syncTimer);
			session.syncTimer = undefined;
		}
	};

	const refreshFooterStatuses = (session: ActiveSession): void => {
		session.context.ui.setStatus(
			PI_TODO_GATE_PR,
			renderPrStatus(session.state.prUrl, session.context.ui.theme),
		);
		session.context.ui.setStatus(
			PI_TODO_GATE_TASK,
			renderTaskStatus(
				session.state.taskUrl,
				session.context.ui.theme,
				session.state.taskName,
			),
		);
	};

	const clearFooterStatuses = (session: ActiveSession): void => {
		session.context.ui.setStatus(PI_TODO_GATE_PR, undefined);
		session.context.ui.setStatus(PI_TODO_GATE_TASK, undefined);
	};

	const deactivate = (session: ActiveSession): void => {
		cancelScheduledSync(session);
		clearFooterStatuses(session);
		session.context.ui.setFooter(undefined);
	};

	const linkInferredTask = async (
		session: ActiveSession,
		prompt = EMPTY_STRING,
	): Promise<boolean> => {
		if (session.state.taskRef) return false;
		const taskRef = inferClaimedTaskRef(
			session.context.sessionManager.getBranch(),
			prompt,
		);
		if (!taskRef) return false;
		try {
			const client = createClient(session.context, dependencies);
			const project = await client.resolveProject(
				session.project.todoistProjectRef,
			);
			const claimed = await client.claimTask(taskRef, {
				id: project.id,
				currentTaskId: taskRef,
			});
			await syncTodoistToPiTasks(client, claimed.id, taskPath(session));
			session.syncAvailable = true;
			session.state = applyStatePatch(session.state, {
				taskRef: claimed.id,
				taskName: claimed.content,
				taskUrl:
					claimed.webUrl ??
					claimed.url ??
					`https://app.todoist.com/app/task/${claimed.id}`,
			});
			appendState(pi, session.state, !session.allowPrDiscovery);
			refreshFooterStatuses(session);
			return true;
		} catch {
			session.context.ui.notify(
				TODOIST_TASK_WAS_NOT_LINKED_FROM_SESSION,
				WARNING_VALUE,
			);
			return false;
		}
	};

	const scheduleSync = (session: ActiveSession): void => {
		const parentRef = session.state.taskRef;
		if (!parentRef || !session.syncAvailable) return;
		cancelScheduledSync(session);
		const generation = session.syncGeneration;
		const isCurrent = (): boolean =>
			active === session &&
			generation === session.syncGeneration &&
			session.syncAvailable;
		session.syncTimer = setTimeout(async () => {
			session.syncTimer = undefined;
			if (!isCurrent()) return;
			try {
				const store = await readPiTaskStore(taskPath(session));
				await syncPiTasksToTodoist(
					createClient(session.context, dependencies),
					parentRef,
					store ?? { nextId: 1, tasks: [] },
					isCurrent,
				);
			} catch {
				if (isCurrent())
					session.context.ui.notify(TODOIST_TASK_UPDATE_FAILED, WARNING_VALUE);
			}
		}, 25);
	};

	const installTool = (): void => {
		if (registered) return;
		registered = true;
		pi.registerTool<typeof stateParameters>({
			name: PI_TODO_GATE_STATE,
			label: TODO_GATE_STATE,
			description: INSPECT_OR_CHANGE_THIS_SESSION_S_PINNED,
			promptSnippet: INSPECT_OR_UPDATE_THE_SESSION_PR_AND,
			parameters: stateParameters,
			async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
				if (!active) throw new Error(PI_TODO_GATE_IS_INACTIVE_FOR_THIS);
				const session = active;
				if (params.action === STATUS) {
					return extensionResult(
						JSON.stringify({
							...session.state,
							codingRoot: session.project.codingRoot,
						}),
					);
				}
				if (params.action === SET_PR) {
					const url = githubPrUrl(params.url ?? EMPTY_STRING);
					if (!url) throw new Error(SET_PR_REQUIRES_A_VALID_GITHUB_PULL);
					const prChanged = session.state.prUrl !== url;
					session.state = applyStatePatch(session.state, {
						prUrl: url,
						...(prChanged
							? {
									mergeCompletedAt: undefined,
									todoistCompletionAttemptedAt: undefined,
								}
							: {}),
					});
					session.allowPrDiscovery = false;
					appendState(pi, session.state);
					refreshFooterStatuses(session);
					return extensionResult(`Pinned PR ${url}`);
				}
				if (params.action === CLEAR_PR) {
					session.state = applyStatePatch(session.state, {
						prUrl: undefined,
						mergeCompletedAt: undefined,
						todoistCompletionAttemptedAt: undefined,
					});
					session.allowPrDiscovery = false;
					appendState(pi, session.state, true);
					refreshFooterStatuses(session);
					return extensionResult(CLEARED_THE_PINNED_PR);
				}
				if (params.action === SET_TASK) {
					if (!params.task)
						throw new Error(SET_TASK_REQUIRES_A_TODOIST_TASK_REFERENCE);
					cancelScheduledSync(session);
					const client = createClient(ctx, dependencies);
					const project = await client.resolveProject(
						session.project.todoistProjectRef,
					);
					const claimed = await client.claimTask(params.task, {
						id: project.id,
						currentTaskId: session.state.taskRef,
					});
					await syncTodoistToPiTasks(client, claimed.id, taskPath(session));
					session.syncAvailable = true;
					const taskChanged = session.state.taskRef !== claimed.id;
					session.state = applyStatePatch(session.state, {
						taskRef: claimed.id,
						taskName: claimed.content,
						taskUrl: claimed.webUrl ?? claimed.url,
						...(taskChanged
							? {
									mergeCompletedAt: undefined,
									todoistCompletionAttemptedAt: undefined,
								}
							: {}),
					});
					appendState(pi, session.state, !session.allowPrDiscovery);
					refreshFooterStatuses(session);
					return extensionResult(
						`Claimed Todoist task ${claimed.webUrl ?? claimed.url ?? claimed.id}`,
					);
				}
				if (params.action === CLEAR_TASK) {
					cancelScheduledSync(session);
					session.state = applyStatePatch(session.state, {
						taskRef: undefined,
						taskName: undefined,
						taskUrl: undefined,
						mergeCompletedAt: undefined,
						todoistCompletionAttemptedAt: undefined,
					});
					await clearLocalTasks(session);
					appendState(pi, session.state, !session.allowPrDiscovery);
					refreshFooterStatuses(session);
					return extensionResult(CLEARED_THE_CLAIMED_TODOIST_TASK);
				}
				cancelScheduledSync(session);
				session.state = {};
				session.allowPrDiscovery = false;
				await clearLocalTasks(session);
				appendState(pi, session.state, true);
				refreshFooterStatuses(session);
				return extensionResult(CLEARED_SESSION_PR_AND_TASK_LINKS);
			},
		});
	};

	pi.on(SESSION_START, async (event, ctx) => {
		const config = await (dependencies.loadConfig ?? loadConfig)();
		const project = resolveConfiguredProject(ctx.cwd, config);
		if (!project) {
			if (active) {
				deactivate(active);
				if (pi.getActiveTools && pi.setActiveTools) {
					pi.setActiveTools(
						pi.getActiveTools().filter((name) => name !== PI_TODO_GATE_STATE),
					);
				}
			}
			active = null;
			return;
		}
		if (active) deactivate(active);
		const branch = ctx.sessionManager.getBranch();
		const stateEntry = latestStateData(branch);
		let state = latestState(branch);
		let handoffContext = false;
		let allowPrDiscovery =
			stateEntry?.prDiscoveryDisabled !== true && !state.prUrl;
		if (stateEntry === null && event.previousSessionFile) {
			const previous: SessionReader =
				dependencies.openSession?.(event.previousSessionFile) ??
				SessionManager.open(event.previousSessionFile);
			const previousProject = resolveConfiguredProject(
				previous.getCwd(),
				config,
			);
			const sameCodingProject =
				previousProject?.codingRoot === project.codingRoot;
			const inherited = sameCodingProject
				? extractInheritedState(previous.getBranch())
				: null;
			if (inherited) {
				state = { ...inherited, inheritedFrom: previous.getSessionId() };
				appendState(pi, state);
				handoffContext = true;
				allowPrDiscovery = false;
			}
		}
		active = {
			context: ctx,
			project,
			state,
			allowPrDiscovery,
			handoffContext,
			workChanged: false,
			syncAvailable: true,
			syncGeneration: 0,
		};
		const taskWasSynced = state.taskRef
			? false
			: await linkInferredTask(active);
		installTool();
		if (registered && pi.getActiveTools && pi.setActiveTools) {
			const activeTools = pi.getActiveTools();
			if (!activeTools.includes(PI_TODO_GATE_STATE)) {
				pi.setActiveTools([...activeTools, PI_TODO_GATE_STATE]);
			}
		}
		if (ctx.mode === TUI) ctx.ui.setFooter(undefined);
		refreshFooterStatuses(active);
		if (active.allowPrDiscovery)
			persistPrIfAvailable(
				firstGithubPrUrl(branchTexts(branch)) ?? EMPTY_STRING,
			);
		if (state.taskRef && !taskWasSynced) {
			try {
				await syncTodoistToPiTasks(
					createClient(ctx, dependencies),
					state.taskRef,
					taskPath(active),
				);
			} catch {
				active.syncAvailable = false;
				ctx.ui.notify(TODOIST_TASK_RESTORE_FAILED, WARNING_VALUE);
			}
		}
	});

	pi.on(MESSAGE_END, async (event) => {
		if (!active) return;
		persistPrIfAvailable(textOf(event.message));
	});

	pi.on(BEFORE_AGENT_START, async (event, ctx) => {
		if (!active) return;
		if (!active.state.taskRef) {
			await linkInferredTask(active, event.prompt ?? EMPTY_STRING);
		}
		const messages: string[] = [];
		if (active.handoffContext) {
			messages.push(
				`This is the task and PR that we were working on.\nTask: ${active.state.taskUrl ?? NONE}\nPR: ${active.state.prUrl ?? NONE}`,
			);
			active.handoffContext = false;
		}
		if (!active.state.taskRef) messages.push(MISSING_TASK_WARNING);
		if (active.workChanged) {
			const worktree = await inspectWorktree(
				dependencies.exec ?? spawnExec,
				ctx.cwd,
			);
			if (worktree.isWorktree && worktree.branch) {
				const pr = await findOpenPrSafe(
					ctx,
					worktree.branch,
					dependencies.exec ?? spawnExec,
				);
				if (pr === UNKNOWN_VALUE)
					messages.push(GITHUB_PR_LOOKUP_UNAVAILABLE_VERIFY_GH_AUTHENTICATION);
				else if (pr === null)
					messages.push(WHEN_IMPLEMENTATION_IS_FINISHED_PUSH_THIS_BRANCH);
			}
		}
		return messages.length
			? {
					message: {
						customType: PI_TODO_GATE_CONTEXT,
						content: messages.join(TEXT_2),
						display: false,
					},
				}
			: undefined;
	});

	pi.on(TOOL_RESULT, async (event, ctx) => {
		if (!active || event.isError) return;
		const toolName = String(event.toolName);
		if (toolName === EDIT || toolName === WRITE) active.workChanged = true;
		if (toolName === BASH) {
			const command =
				typeof event.input?.command === "string"
					? event.input.command
					: EMPTY_STRING;
			const resultText = textOf(event.content);
			if (!active.state.taskRef) {
				await linkInferredTask(active, `${command}\n${resultText}`);
			}
			if (
				/\bgit\s+(add|commit|merge|rebase|checkout|switch|cherry-pick)\b/.test(
					command,
				)
			)
				active.workChanged = true;
			if (
				active.state.prUrl &&
				active.state.taskRef &&
				(await matchesPinnedPr(
					dependencies.exec ?? spawnExec,
					ctx.cwd,
					command,
					active.state.prUrl,
				))
			) {
				if (!active.state.todoistCompletionAttemptedAt) {
					try {
						await createClient(ctx, dependencies).completeTask(
							active.state.taskRef,
						);
						active.state = applyStatePatch(active.state, {
							mergeCompletedAt: new Date().toISOString(),
							todoistCompletionAttemptedAt: new Date().toISOString(),
						});
						appendState(pi, active.state);
						ctx.ui.notify(
							MERGED_PR_DETECTED_TODOIST_TASK_COMPLETED,
							INFO_VALUE,
						);
					} catch {
						active.state = applyStatePatch(active.state, {
							todoistCompletionAttemptedAt: new Date().toISOString(),
						});
						appendState(pi, active.state);
						ctx.ui.notify(
							MERGED_PR_DETECTED_BUT_TODOIST_TASK_COMPLETION,
							WARNING_VALUE,
						);
					}
				}
			}
		}
		if (taskToolNames.has(toolName)) scheduleSync(active);
	});

	pi.on(AGENT_SETTLED, () => {
		if (active) scheduleSync(active);
	});

	pi.on(SESSION_SHUTDOWN, () => {
		if (!active) return;
		deactivate(active);
		active = null;
	});
}

async function findOpenPrSafe(
	ctx: ExtensionContext,
	branch: string,
	exec: Exec,
): Promise<string | null | "unknown"> {
	const result = await findOpenPr(exec, ctx.cwd, branch);
	if (result.state === UNKNOWN_VALUE_2) return UNKNOWN_VALUE;
	return result.url;
}
